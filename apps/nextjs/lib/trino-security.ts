// Génération des fichiers de sécurité Trino (durcissement, rbac_refonte.md
// §9) depuis iam.grants — source de vérité unique. Trino devient un artefact
// dérivé, comme les bindings de catalogues. Deux fichiers dans
// TRINO_SECURITY_DIR (répertoire bind-monté dans le conteneur Trino,
// rechargé périodiquement sans redémarrage : file.refresh-period 5 s côté
// authenticator, security.refresh-period 5 s côté access control) :
//
//   - password.db : lignes `user:bcrypt` ($2y$, cost 10) des comptes
//     applicatifs. Le mot de passe n'est JAMAIS stocké côté applicatif :
//     il est affiché une seule fois (même parcours que le clientSecret
//     Polaris) ; seul le hash bcrypt vit dans ce fichier.
//   - rules.json : règles d'access control dérivées des grants de catalogue
//     (read → read-only ; write → SELECT/INSERT/DELETE/UPDATE ;
//     manage → + OWNERSHIP + schémas owner).
//
// Les comptes de service statiques (BFF, mcp-trino) sont gérés côté setup
// (apps/trino/setup.sh) pour password.db ; leurs règles (BFF non contraint —
// la garde RBAC de l'éditeur SQL est applicative via iam.has_grant ;
// mcp-trino en lecture seule globale, borné réellement par
// TRINO_ALLOWED_SCHEMAS côté serveur MCP) sont régénérées ici à chaque
// écriture de rules.json.
//
// Prérequis Trino : première règle qui matche s'applique, sans
// correspondance = refus ; `user`/`catalog` sont des regex (échappement +
// ancres obligatoires) ; les règles tables ne s'appliquent pas à
// information_schema ; le catalogue `system` est accessible à tous par
// défaut.

import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import bcrypt from "bcryptjs";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ParusPrivilege } from "@/lib/polaris";

const TRINO_SERVICE_USER = process.env.TRINO_USER ?? "parus-app";
const TRINO_MCP_USER = process.env.TRINO_MCP_USER ?? "parus-mcp";

export function trinoSecurityDir(): string | null {
  const dir = process.env.TRINO_SECURITY_DIR?.trim();
  return dir || null;
}

// bcryptjs produit un préfixe $2a$/$2b$ ; Trino exige le marqueur $2y$
// (même algorithme bcrypt, marqueur « corrigé » de crypt_blowfish —
// interopérable, htpasswd -B produit la même forme).
export function bcryptForTrino(password: string): string {
  return bcrypt.hashSync(password, 10).replace(/^\$2[ab]\$/, "$2y$");
}

// Mot de passe Trino d'un compte applicatif : aléatoire, affiché une seule
// fois, jamais stocké en clair.
export function generateTrinoPassword(): string {
  return randomBytes(24).toString("hex");
}

// Nom d'utilisateur Trino d'un compte applicatif : le nom du compte
// (pattern APP_USER_NAME_PATTERN : minuscules, chiffres, tirets — sûr pour
// les regex et les en-têtes basic auth).
export function trinoUserOf(appUserName: string): string {
  return appUserName;
}

// Regex Trino : échappement + ancres (règle user/catalog = expression
// régulière, première correspondance qui s'applique).
function userRegex(name: string): string {
  return `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

// ---------------------------------------------------------------------------
// password.db
// ---------------------------------------------------------------------------

async function readPasswordFile(dir: string): Promise<string[]> {
  try {
    const content = await fs.readFile(path.join(dir, "password.db"), "utf-8");
    return content.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#"));
  } catch {
    return [];
  }
}

// Ajoute ou remplace la ligne d'un compte applicatif. Les lignes des autres
// utilisateurs (comptes de service du setup, comptes applicatifs existants)
// sont préservées telles quelles.
export async function upsertTrinoPassword(
  appUserName: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const dir = trinoSecurityDir();
  if (!dir) {
    return {
      ok: false,
      error: "TRINO_SECURITY_DIR n'est pas configuré sur le serveur.",
    };
  }
  try {
    const lines = (await readPasswordFile(dir)).filter(
      (l) => !l.startsWith(`${appUserName}:`),
    );
    lines.push(`${appUserName}:${bcryptForTrino(password)}`);
    await fs.writeFile(
      path.join(dir, "password.db"),
      lines.join("\n") + "\n",
      "utf-8",
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Erreur inattendue.",
    };
  }
}

// Retire la ligne d'un compte applicatif (révocation immédiate, refresh 5 s).
export async function removeTrinoPassword(
  appUserName: string,
): Promise<{ ok: boolean; error?: string }> {
  const dir = trinoSecurityDir();
  if (!dir) {
    return {
      ok: false,
      error: "TRINO_SECURITY_DIR n'est pas configuré sur le serveur.",
    };
  }
  try {
    const lines = (await readPasswordFile(dir)).filter(
      (l) => !l.startsWith(`${appUserName}:`),
    );
    await fs.writeFile(
      path.join(dir, "password.db"),
      lines.join("\n") + "\n",
      "utf-8",
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Erreur inattendue.",
    };
  }
}

// ---------------------------------------------------------------------------
// rules.json — régénération complète depuis iam.grants
// ---------------------------------------------------------------------------

interface RulesFile {
  catalogs: { user: string; catalog?: string; allow: string }[];
  schemas: { user: string; catalog: string; owner: boolean }[];
  tables: {
    user: string;
    catalog: string;
    privileges: string[];
  }[];
}

export async function syncTrinoRules(): Promise<{ ok: boolean; error?: string }> {
  const dir = trinoSecurityDir();
  if (!dir) {
    return {
      ok: false,
      error: "TRINO_SECURITY_DIR n'est pas configuré sur le serveur.",
    };
  }
  const admin = createAdminClient();
  const [{ data: appUsers }, { data: grants }] = await Promise.all([
    admin.schema("iam").from("app_users").select("name, role_id"),
    admin
      .schema("iam")
      .from("grants")
      .select("role_id, resource_id, privileges")
      .eq("resource_type", "catalog"),
  ]);
  // Privilèges par catalogue, par rôle.
  const roleGrants = new Map<string, Map<string, ParusPrivilege[]>>();
  for (const g of (grants ?? []) as {
    role_id: string;
    resource_id: string;
    privileges: ParusPrivilege[];
  }[]) {
    const byCatalog =
      roleGrants.get(g.role_id) ?? new Map<string, ParusPrivilege[]>();
    byCatalog.set(g.resource_id, g.privileges);
    roleGrants.set(g.role_id, byCatalog);
  }

  const rules: RulesFile = {
    // Comptes de service en tête : la première règle qui matche s'applique,
    // le BFF ne doit jamais être contraint (garde applicative).
    catalogs: [
      { user: userRegex(TRINO_SERVICE_USER), allow: "all" },
      { user: userRegex(TRINO_MCP_USER), allow: "read-only" },
    ],
    schemas: [],
    tables: [],
  };

  for (const appUser of (appUsers ?? []) as { name: string; role_id: string }[]) {
    const grants = roleGrants.get(appUser.role_id);
    if (!grants) continue; // Aucun accès : aucune règle = refus par défaut.
    const user = userRegex(trinoUserOf(appUser.name));
    for (const [catalog, privileges] of grants) {
      if (privileges.includes("manage")) {
        rules.catalogs.push({ user, catalog: userRegex(catalog), allow: "all" });
        rules.schemas.push({ user, catalog: userRegex(catalog), owner: true });
        rules.tables.push({
          user,
          catalog: userRegex(catalog),
          privileges: ["SELECT", "INSERT", "DELETE", "UPDATE", "OWNERSHIP"],
        });
      } else if (privileges.includes("write")) {
        rules.catalogs.push({ user, catalog: userRegex(catalog), allow: "all" });
        rules.tables.push({
          user,
          catalog: userRegex(catalog),
          privileges: ["SELECT", "INSERT", "DELETE", "UPDATE"],
        });
      } else if (privileges.includes("read")) {
        rules.catalogs.push({
          user,
          catalog: userRegex(catalog),
          allow: "read-only",
        });
      }
    }
  }

  try {
    await fs.writeFile(
      path.join(dir, "rules.json"),
      JSON.stringify(rules, null, 2) + "\n",
      "utf-8",
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Erreur inattendue.",
    };
  }
}

// Resynchronisation paresseuse (rattrapage de dérive, appelée avant une
// requête BFF) : rules.json uniquement, une fois par processus — les mots de
// passe applicatifs ne sont pas re-générables (jamais stockés). Les actions
// admin déclenchent déjà la génération à chaque mutation.
let ensuredOnce = false;
let ensuring: Promise<void> | null = null;
export async function ensureTrinoSecurity(): Promise<void> {
  if (ensuredOnce) return;
  if (ensuring) return ensuring;
  ensuring = (async () => {
    if (!trinoSecurityDir()) return;
    const result = await syncTrinoRules();
    if (result.ok) ensuredOnce = true;
  })().finally(() => {
    ensuring = null;
  });
  return ensuring;
}

// Le nom d'un compte applicatif ne doit pas entrer en collision avec un
// compte de service Trino (BFF, mcp-trino).
export function isReservedTrinoUserName(name: string): boolean {
  return name === TRINO_SERVICE_USER || name === TRINO_MCP_USER;
}
