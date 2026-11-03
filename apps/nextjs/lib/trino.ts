// Client Trino (moteur SQL unique du lakehouse, AGENTS.md §10) — basé sur le
// client officiel trino-js-client (npm `trino-client`, même dépôt que
// @trinodb/trino-js-client ; le nom scopé exige Node 24, la machine tourne
// en Node 22 — à renommer lors d'une montée de version de Node).
// Aucune chaîne de connexion côté navigateur : tout passe par le serveur
// Next.js, en HTTPS + basic auth (durcissement, spec fonctionnelle § « Intégration Technique » (durcissement Trino)).
//
// Deux identités d'exécution :
//   - trinoQuery : le compte de service BFF (usage infrastructure uniquement
//     — lecture du catalogue `system` via le CLI, il n'a plus d'usage
//     data-plane depuis la migration de l'éditeur sur les comptes de rôle) ;
//   - trinoQueryAs / roleTrinoExecutor : le compte Trino du rôle ACTIF de
//     l'utilisateur (parus-role-<role_id>, contraint par rules.json) — le
//     refus de la qualification croisée de catalogue est effectif PAR TRINO,
//     la garde applicative iam.has_grant reste le premier filtre (message
//     d'erreur explicite avant d'atteindre Trino).

import { BasicAuth, Trino, type Columns } from "trino-client";

import { ensureTrinoSecurity, roleTrinoCredentials } from "@/lib/trino-security";

export interface TrinoColumn {
  name: string;
  type: string;
}

export interface TrinoQueryResult {
  columns: TrinoColumn[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
}

// Fonction d'exécution de requêtes : toute requête portée par une session
// utilisateur s'exécute via un executor de rôle — jamais le compte BFF.
export type TrinoExecutor = (sql: string) => Promise<TrinoQueryResult>;

const TRINO_URL = process.env.TRINO_URL ?? "https://localhost:8453";
const TRINO_USER = process.env.TRINO_USER ?? "parus-app";
const TRINO_PASSWORD = process.env.TRINO_PASSWORD ?? "";
const MAX_ROWS = 1000;

function createTrinoFor(user: string, password: string): Trino {
  return Trino.create({
    server: TRINO_URL,
    source: "parusdb-app",
    auth: new BasicAuth(user, password),
    // Certificat autosigné généré par apps/trino/setup.sh (réseau privé,
    // friction documentée dans /admin/informations).
    ssl: { rejectUnauthorized: false },
  });
}

// Exécute une requête sous une identité donnée et agrège les pages de
// résultats (max MAX_ROWS lignes).
async function runQueryAs(
  user: string,
  password: string,
  sql: string,
): Promise<TrinoQueryResult> {
  // Rattrapage de dérive éventuelle des fichiers de sécurité (rules.json)
  // — génération paresseuse, une fois par cycle de vie du processus.
  await ensureTrinoSecurity();
  const started = Date.now();
  const iter = await createTrinoFor(user, password).query({ query: sql, user });
  let columns: Columns = [];
  const rows: unknown[][] = [];
  for await (const page of iter) {
    if (page.error) {
      throw new Error(
        `Trino : ${page.error.message}${
          page.error.errorName ? ` (${page.error.errorName})` : ""
        }`,
      );
    }
    if (page.columns && columns.length === 0) {
      columns = page.columns;
    }
    if (page.data && page.data.length > 0) {
      rows.push(...page.data);
      if (rows.length >= MAX_ROWS) {
        rows.length = MAX_ROWS;
        break;
      }
    }
  }
  return {
    columns: columns.map((c) => ({ name: c.name, type: c.type })),
    rows,
    rowCount: rows.length,
    durationMs: Date.now() - started,
  };
}

// Requête d'infrastructure sous le compte de service BFF : aucun usage
// data-plane ne doit passer par ici (le compte est restreint à `system`
// dans rules.json) — réserver aux diagnostics/CLI.
export async function trinoQuery(sql: string): Promise<TrinoQueryResult> {
  return runQueryAs(TRINO_USER, TRINO_PASSWORD, sql);
}

// Requête sous un compte Trino explicite (compte de rôle ou applicatif).
export async function trinoQueryAs(
  user: string,
  password: string,
  sql: string,
): Promise<TrinoQueryResult> {
  return runQueryAs(user, password, sql);
}

// Executor des requêtes d'une session : le compte Trino du rôle actif.
// Les credentials sont créés/rattrapés au besoin (lazy) et mis en cache.
export async function roleTrinoExecutor(roleId: string): Promise<TrinoExecutor> {
  const creds = await roleTrinoCredentials(roleId);
  if (!creds) {
    throw new Error(
      "Aucun compte Trino n'est associé au rôle actif : contactez un administrateur.",
    );
  }
  return (sql) => trinoQueryAs(creds.username, creds.password, sql);
}

// Executor d'une session utilisateur. Cohérence avec iam.has_grant : un
// compte admin hérite de tout QUEL QUE SOIT son rôle actif (l'administration
// est une capacité du compte) — on utilise alors le compte du rôle admin,
// faute de quoi Trino refuserait ce que la garde applicative a permis.
export async function sessionTrinoExecutor(
  session: { isAdmin: boolean; roles: { id: string; key: string }[]; activeRole: { id: string } | null },
): Promise<TrinoExecutor> {
  if (session.isAdmin) {
    const adminRole = session.roles.find((r) => r.key === "admin");
    if (adminRole) return roleTrinoExecutor(adminRole.id);
  }
  if (!session.activeRole) {
    throw new Error(
      "Aucun rôle actif : impossible d'exécuter une requête. Contactez un administrateur.",
    );
  }
  return roleTrinoExecutor(session.activeRole.id);
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
