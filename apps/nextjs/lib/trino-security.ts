// Génération des fichiers de sécurité Trino (durcissement, spec fonctionnelle
// §9) depuis iam.grants - source de vérité unique. Trino devient un artefact
// dérivé, comme les bindings de catalogues. Deux fichiers dans
// TRINO_SECURITY_DIR (répertoire bind-monté dans le conteneur Trino,
// rechargé périodiquement sans redémarrage : file.refresh-period 5 s côté
// authenticator, security.refresh-period 5 s côté access control) :
//
//   - password.db : lignes `user:bcrypt` ($2y$, cost 10) des comptes
//     applicatifs ET des comptes de rôle (éditeur SQL, cf. ci-dessous).
//     Le mot de passe d'un compte applicatif n'est JAMAIS stocké côté
//     applicatif : il est affiché une seule fois (même parcours que le
//     clientSecret Polaris) ; seul le hash bcrypt vit dans ce fichier.
//     Le mot de passe d'un compte de rôle, utilisé par le BFF à chaque
//     requête de l'éditeur, est stocké chiffré AES-256-GCM dans
//     iam.role_trino_accounts (RLS sans politique : seul le service_role
//     du BFF y accède, jamais le navigateur).
//   - rules.json : règles d'access control dérivées des grants de catalogue
//     (read → read-only ; write → SELECT/INSERT/DELETE/UPDATE ;
//     manage → + OWNERSHIP + schémas owner) + de la propriété des
//     catalogues (lakehouse.catalog_registry.owner_role_id ≈ manage).
//
// Comptes de rôle (refus réel de l'éditeur SQL) : un compte Trino
// `parus-role-<role_id>` par rôle applicatif. Les requêtes SQL des
// utilisateurs (éditeur, explorateur, purge à la suppression) s'exécutent
// sous le compte du rôle ACTIF, contraint par rules.json - la qualification
// croisée de catalogue (`SELECT * FROM prod.x.y` avec un grant sur dev
// seule) est refusée PAR TRINO, pas seulement par la garde applicative
// iam.has_grant. Le rôle `admin` (hérite de tout) reçoit allow:all ; un
// rôle sans aucun accès reçoit allow:none (compte inerte).
//
// Les comptes de service statiques sont gérés côté setup
// (apps/trino/setup.sh) pour password.db. Le compte BFF (`parus-app`) n'a
// plus d'usage data-plane depuis la migration de l'éditeur sur les comptes
// de rôle : il est restreint ici à la lecture du catalogue `system`
// (diagnostic CLI) et refusé ailleurs - les endpoints HTTP /v1/query et
// /v1/info du cycle de redémarrage ne sont pas soumis à l'access control
// (vérifié empiriquement). mcp-trino reste en lecture seule globale (borné
// réellement par TRINO_ALLOWED_SCHEMAS côté serveur MCP).
//
// Prérequis Trino (vérifiés empiriquement sur trino:484) : première règle
// qui matche s'applique ; sans correspondance = refus SAUF pour le
// catalogue `system`, accessible à tous par défaut - il faut une règle
// explicite `allow: "none"` par compte pour le fermer (sinon
// system.runtime.queries expose le SQL des requêtes des autres
// utilisateurs). `user`/`catalog` sont des regex (échappement + ancres
// obligatoires) ; les règles tables ne s'appliquent pas à
// information_schema ; une requête sans catalogue (`SELECT 1`) passe
// toujours, même sans règle.

import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import bcrypt from "bcryptjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { ParusPrivilege } from "@/lib/polaris";

const TRINO_SERVICE_USER = process.env.TRINO_USER ?? "parus-app";
const TRINO_MCP_USER = process.env.TRINO_MCP_USER ?? "parus-mcp";
// Compte outillage (CLI, seed e2e) : accès complet, jamais utilisé par le
// BFF pour des requêtes portées par une session utilisateur. Seul le nom
// est connu de l'application - le mot de passe vit dans apps/trino/.env.
const TRINO_OPS_USER = process.env.TRINO_OPS_USER ?? "parus-ops";
// Préfixe réservé des comptes de rôle : parus-role-<role uuid>.
export const TRINO_ROLE_USER_PREFIX = "parus-role-";

export function trinoSecurityDir(): string | null {
  const dir = process.env.TRINO_SECURITY_DIR?.trim();
  return dir || null;
}

// bcryptjs produit un préfixe $2a$/$2b$ ; Trino exige le marqueur $2y$
// (même algorithme bcrypt, marqueur « corrigé » de crypt_blowfish -
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
// (pattern APP_USER_NAME_PATTERN : minuscules, chiffres, tirets - sûr pour
// les regex et les en-têtes basic auth).
export function trinoUserOf(appUserName: string): string {
  return appUserName;
}

// Nom d'utilisateur Trino du compte d'un rôle applicatif : dérivé de
// l'uuid du rôle (invariable, sans collision possible avec un compte
// applicatif - le préfixe est réservé, cf. isReservedTrinoUserName).
export function trinoRoleUser(roleId: string): string {
  return `${TRINO_ROLE_USER_PREFIX}${roleId}`;
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
// rules.json - régénération complète depuis iam.grants
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

// Règles d'un compte sur un catalogue selon le privilège maximal détenu
// (hiérarchie manage ⊇ write ⊇ read) - mapping commun aux comptes de rôle
// et aux comptes applicatifs.
function pushCatalogRules(
  rules: RulesFile,
  user: string,
  catalogRegex: string,
  privileges: ParusPrivilege[],
): void {
  if (privileges.includes("manage")) {
    rules.catalogs.push({ user, catalog: catalogRegex, allow: "all" });
    rules.schemas.push({ user, catalog: catalogRegex, owner: true });
    rules.tables.push({
      user,
      catalog: catalogRegex,
      privileges: ["SELECT", "INSERT", "DELETE", "UPDATE", "OWNERSHIP"],
    });
  } else if (privileges.includes("write")) {
    rules.catalogs.push({ user, catalog: catalogRegex, allow: "all" });
    rules.tables.push({
      user,
      catalog: catalogRegex,
      privileges: ["SELECT", "INSERT", "DELETE", "UPDATE"],
    });
  } else if (privileges.includes("read")) {
    rules.catalogs.push({ user, catalog: catalogRegex, allow: "read-only" });
  }
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
  const [{ data: appUsers }, { data: grants }, { data: roles }, { data: owners }] =
    await Promise.all([
      admin.schema("iam").from("app_users").select("name, role_id"),
      admin
        .schema("iam")
        .from("grants")
        .select("role_id, resource_id, privileges")
        .eq("resource_type", "catalog"),
      admin.schema("iam").from("roles").select("id, key"),
      admin
        .schema("lakehouse")
        .from("catalog_registry")
        .select("catalog_name, owner_role_id"),
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
  // Propriété d'un catalogue ≈ manage (miroir de iam.has_grant) : fusionnée
  // dans la map des grants.
  for (const o of (owners ?? []) as {
    catalog_name: string;
    owner_role_id: string | null;
  }[]) {
    if (!o.owner_role_id) continue;
    const byCatalog =
      roleGrants.get(o.owner_role_id) ?? new Map<string, ParusPrivilege[]>();
    byCatalog.set(o.catalog_name, ["manage"]);
    roleGrants.set(o.owner_role_id, byCatalog);
  }

  // Le catalogue `system` est ouvert à tous par défaut : fermeture explicite
  // par compte (sinon system.runtime.queries expose le SQL des autres).
  const SYSTEM = userRegex("system");
  const DENY_SYSTEM = { catalog: SYSTEM, allow: "none" as const };

  const rules: RulesFile = {
    // Ordre = première règle qui matche : les comptes de service en tête,
    // puis les rôles, puis les comptes applicatifs.
    catalogs: [
      // Compte BFF : plus d'usage data-plane depuis la migration de
      // l'éditeur sur les comptes de rôle. Lecture du catalogue system
      // uniquement (diagnostic CLI `sh run.sh cli`) - les endpoints HTTP
      // de supervision (trino-restart) ne sont pas soumis à l'access
      // control.
      { user: userRegex(TRINO_SERVICE_USER), catalog: SYSTEM, allow: "read-only" },
      { user: userRegex(TRINO_SERVICE_USER), allow: "none" },
      { user: userRegex(TRINO_MCP_USER), allow: "read-only" },
      // Compte outillage (CLI apps/trino/run.sh, seed du test e2e Chat IA) :
      // accès complet - opération d'exploitation, hors chemin des requêtes
      // des utilisateurs (comptes de rôle ci-dessous).
      { user: userRegex(TRINO_OPS_USER), allow: "all" },
    ],
    schemas: [],
    tables: [],
  };

  // Rôles : le compte parus-role-<id> du rôle actif porte ses droits réels
  // - refus de la qualification croisée PAR TRINO. Le rôle admin hérite de
  // tout (allow:all) ; un rôle sans accès catalogue reçoit allow:none
  // (compte inerte : seul `SELECT 1` sans catalogue passe).
  for (const role of (roles ?? []) as { id: string; key: string }[]) {
    const user = userRegex(trinoRoleUser(role.id));
    if (role.key === "admin") {
      rules.catalogs.push({ user, allow: "all" });
      continue;
    }
    rules.catalogs.push({ user, ...DENY_SYSTEM });
    const grants = roleGrants.get(role.id);
    if (!grants) {
      rules.catalogs.push({ user, allow: "none" });
      continue;
    }
    for (const [catalog, privileges] of grants) {
      pushCatalogRules(rules, user, userRegex(catalog), privileges);
    }
  }

  for (const appUser of (appUsers ?? []) as { name: string; role_id: string }[]) {
    const grants = roleGrants.get(appUser.role_id);
    if (!grants) continue; // Aucun accès : aucune règle = refus par défaut.
    const user = userRegex(trinoUserOf(appUser.name));
    rules.catalogs.push({ user, ...DENY_SYSTEM });
    for (const [catalog, privileges] of grants) {
      pushCatalogRules(rules, user, userRegex(catalog), privileges);
    }
  }

  try {
    // Piège Trino (vérifié empiriquement) : les clés "schemas" et "tables"
    // présentes mais VIDES font échouer SHOW SCHEMAS pour tous les
    // utilisateurs, y compris allow:all - une section sans règle doit être
    // absente du JSON, jamais un tableau vide.
    const file: Record<string, unknown> = { catalogs: rules.catalogs };
    if (rules.schemas.length > 0) file.schemas = rules.schemas;
    if (rules.tables.length > 0) file.tables = rules.tables;
    await fs.writeFile(
      path.join(dir, "rules.json"),
      JSON.stringify(file, null, 2) + "\n",
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
// requête BFF) : comptes de rôle (création/rattrapage, mots de passe
// chiffrés donc régénérables - contrairement aux comptes applicatifs) puis
// rules.json, une fois par processus. Les actions admin déclenchent déjà
// la génération à chaque mutation.
let ensuredOnce = false;
let ensuring: Promise<void> | null = null;
export async function ensureTrinoSecurity(): Promise<void> {
  if (ensuredOnce) return;
  if (ensuring) return ensuring;
  ensuring = (async () => {
    if (!trinoSecurityDir()) return;
    const accounts = await ensureRoleTrinoAccounts();
    const result = accounts.ok ? await syncTrinoRules() : accounts;
    if (result.ok) ensuredOnce = true;
  })().finally(() => {
    ensuring = null;
  });
  return ensuring;
}

// Le nom d'un compte applicatif ne doit pas entrer en collision avec un
// compte de service Trino (BFF, mcp-trino) ni usurper le préfixe réservé
// des comptes de rôle.
export function isReservedTrinoUserName(name: string): boolean {
  return (
    name === TRINO_SERVICE_USER ||
    name === TRINO_MCP_USER ||
    name === TRINO_OPS_USER ||
    name.startsWith(TRINO_ROLE_USER_PREFIX)
  );
}

// ---------------------------------------------------------------------------
// Comptes de rôle (iam.role_trino_accounts) - créés paresseusement, mot de
// passe chiffré AES-256-GCM, ligne bcrypt fusionnée dans password.db.
// ---------------------------------------------------------------------------

// Cache en mémoire du processus serveur : évite une requête + un
// déchiffrement par requête SQL de l'éditeur.
const roleCredentialsCache = new Map<
  string,
  { username: string; password: string }
>();

// Re-synchronise les comptes de rôle : crée les manquants (rôle créé depuis
// l'administration), restaure les lignes password.db perdues (dossier
// security réinitialisé) depuis le mot de passe chiffré, et retire les
// lignes orphelines (rôle supprimé - la ligne SQL est cascade-détriuite).
export async function ensureRoleTrinoAccounts(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const dir = trinoSecurityDir();
  if (!dir) {
    // Durcissement non déployé (pas de dossier accessible) : rien à faire.
    return { ok: true };
  }
  const admin = createAdminClient();
  const [{ data: roles }, { data: accounts }] = await Promise.all([
    admin.schema("iam").from("roles").select("id"),
    admin
      .schema("iam")
      .from("role_trino_accounts")
      .select("role_id, username, password_encrypted"),
  ]);
  const roleIds = new Set((roles ?? []).map((r: { id: string }) => r.id));
  const byRole = new Map(
    ((accounts ?? []) as {
      role_id: string;
      username: string;
      password_encrypted: string;
    }[]).map((a) => [a.role_id, a]),
  );

  // 1. Comptes manquants : mot de passe aléatoire + insertion chiffrée +
  //    ligne bcrypt dans password.db.
  for (const role of roles ?? []) {
    if (byRole.has(role.id)) continue;
    const username = trinoRoleUser(role.id);
    const password = generateTrinoPassword();
    const { error } = await admin
      .schema("iam")
      .from("role_trino_accounts")
      .upsert(
        { role_id: role.id, username, password_encrypted: encryptSecret(password) },
        { onConflict: "role_id", ignoreDuplicates: true },
      );
    if (error) {
      return { ok: false, error: error.message };
    }
    const pw = await upsertTrinoPassword(username, password);
    if (!pw.ok) return pw;
    byRole.set(role.id, { role_id: role.id, username, password_encrypted: "" });
  }

  // 2. Lignes password.db manquantes : restaurées depuis le mot de passe
  //    chiffré (le dossier security peut être régénéré indépendamment).
  const existing = new Set(
    (await readPasswordFile(dir)).map((l) => l.split(":")[0]),
  );
  const stale: string[] = [];
  for (const account of byRole.values()) {
    if (roleIds.has(account.role_id) && !account.username.startsWith(TRINO_ROLE_USER_PREFIX)) {
      continue; // compte applicatif : géré par les actions admin
    }
    if (roleIds.has(account.role_id)) {
      if (!existing.has(account.username) && account.password_encrypted) {
        const pw = await upsertTrinoPassword(
          account.username,
          decryptSecret(account.password_encrypted),
        );
        if (!pw.ok) return pw;
      }
    } else {
      stale.push(account.username);
    }
  }
  // 3. Comptes de rôle supprimés (rôle absent) : retirer la ligne bcrypt.
  for (const line of (await readPasswordFile(dir))) {
    const name = line.split(":")[0];
    if (name.startsWith(TRINO_ROLE_USER_PREFIX) && !byRoleHas(byRole, name)) {
      stale.push(name);
    }
  }
  for (const name of [...new Set(stale)]) {
    const pw = await removeTrinoPassword(name);
    if (!pw.ok) return pw;
  }
  return { ok: true };
}

function byRoleHas(
  byRole: Map<string, { username: string }>,
  username: string,
): boolean {
  return [...byRole.values()].some((a) => a.username === username);
}

// Credentials du compte Trino d'un rôle, pour l'exécution des requêtes de
// l'éditeur sous l'identité du rôle actif. Crée le compte s'il manque
// (rattrapage, p.ex. rôle créé pendant la vie du processus serveur).
export async function roleTrinoCredentials(
  roleId: string,
): Promise<{ username: string; password: string } | null> {
  const cached = roleCredentialsCache.get(roleId);
  if (cached) return cached;
  const admin = createAdminClient();
  const fetchAccount = async () =>
    admin
      .schema("iam")
      .from("role_trino_accounts")
      .select("username, password_encrypted")
      .eq("role_id", roleId)
      .maybeSingle();
  let { data: account } = await fetchAccount();
  if (!account) {
    const ensured = await ensureRoleTrinoAccounts();
    if (!ensured.ok) {
      throw new Error(
        `La synchronisation des comptes Trino de rôle a échoué : ${ensured.error}`,
      );
    }
    ({ data: account } = await fetchAccount());
  }
  if (!account) return null;
  const creds = {
    username: account.username,
    password: decryptSecret(account.password_encrypted),
  };
  roleCredentialsCache.set(roleId, creds);
  return creds;
}
