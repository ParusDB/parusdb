// Client Trino (moteur SQL unique du lakehouse, AGENTS.md §10) — basé sur le
// client officiel trino-js-client (npm `trino-client`, même dépôt que
// @trinodb/trino-js-client ; le nom scopé exige Node 24, la machine tourne
// en Node 22 — à renommer lors d'une montée de version de Node).
// Aucune chaîne de connexion côté navigateur : tout passe par le serveur
// Next.js, en HTTPS + authentification basic auth du compte de service BFF
// (durcissement, rbac_refonte.md §9 — les règles d'access control ne
// contraignent pas ce compte : le RBAC de l'éditeur SQL est applicatif via
// iam.has_grant).

import { BasicAuth, Trino, type Columns } from "trino-client";

import { ensureTrinoSecurity } from "@/lib/trino-security";

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

const TRINO_URL = process.env.TRINO_URL ?? "https://localhost:8453";
const TRINO_USER = process.env.TRINO_USER ?? "parus-app";
const TRINO_PASSWORD = process.env.TRINO_PASSWORD ?? "";
const MAX_ROWS = 1000;

function createTrino(): Trino {
  return Trino.create({
    server: TRINO_URL,
    source: "parusdb-app",
    auth: new BasicAuth(TRINO_USER, TRINO_PASSWORD),
    // Certificat autosigné généré par apps/trino/setup.sh (réseau privé,
    // friction documentée dans /admin/informations).
    ssl: { rejectUnauthorized: false },
  });
}

// Exécute une requête et agrège les pages de résultats (max MAX_ROWS lignes).
export async function trinoQuery(sql: string): Promise<TrinoQueryResult> {
  // Rattrapage de dérive éventuelle des fichiers de sécurité (rules.json)
  // — génération paresseuse, une fois par cycle de vie du processus.
  await ensureTrinoSecurity();
  const started = Date.now();
  const iter = await createTrino().query({ query: sql, user: TRINO_USER });
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

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
