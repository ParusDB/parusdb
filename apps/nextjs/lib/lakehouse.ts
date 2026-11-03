import { existsSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_CATALOG,
  listCatalogs,
} from "@/lib/polaris";
import { quoteIdent, type TrinoExecutor } from "@/lib/trino";
import type { CatalogEntry } from "@/types/db";

// Helpers Data Lakehouse côté serveur. Rôles stricts (AGENTS.md §10) :
// Polaris = métadonnées, Trino = moteur SQL, l'app n'écrit jamais dans S3.

export interface CatalogView {
  name: string;
  description: string | null;
  createdAt: string | null;
  binding: string | null;
  isDefault: boolean;
}

// Catalogue Trino lié à un catalogue Polaris : le binding porte toujours le
// nom du catalogue (catalog/<catalogue>.properties — le fichier du catalogue
// par défaut et du catalogue système est généré par apps/trino/setup.sh, les
// autres le sont à la création par l'app).
export function trinoBindingFor(catalog: string): string | null {
  const dir = process.env.TRINO_CATALOG_DIR;
  if (!dir) {
    // Sans dossier accessible, seul le catalogue par défaut est réputé lié
    // (son binding est posé par le setup de Trino, hors de portée du BFF).
    return catalog === DEFAULT_CATALOG ? catalog : null;
  }
  return existsSync(path.join(dir, `${catalog}.properties`)) ? catalog : null;
}

// Fusion Polaris (source de vérité) + registre applicatif (description).
export function mergeCatalogs(
  polarisNames: string[],
  registry: CatalogEntry[],
): CatalogView[] {
  const byName = new Map(registry.map((r) => [r.catalog_name, r]));
  return polarisNames
    .map((name) => {
      const entry = byName.get(name);
      return {
        name,
        description: entry?.description ?? null,
        createdAt: entry?.created_at ?? null,
        binding: trinoBindingFor(name),
        isDefault: name === DEFAULT_CATALOG,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadCatalogViews(
  registry: CatalogEntry[],
): Promise<CatalogView[]> {
  const polaris = await listCatalogs();
  return mergeCatalogs(
    polaris.map((c) => c.name),
    registry,
  );
}

// Contenu du fichier de binding Trino d'un catalogue Polaris. Reprend le
// format généré par apps/trino/setup.sh : seuls l'URI et le realm restent
// substitués par l'environnement du conteneur ; le warehouse est le catalogue
// cible.
export function trinoBindingFileContent(catalog: string): string {
  return `#
# Catalogue Trino "${catalog}" : Iceberg REST -> Polaris (généré par ParusDB).
# Chargé par Trino à son prochain (re)démarrage — automatique après création
# via l'application (dès qu'aucune requête n'est en cours).
#
connector.name=iceberg
iceberg.catalog.type=rest
iceberg.rest-catalog.uri=\${ENV:POLARIS_URI}
iceberg.rest-catalog.security=OAUTH2
iceberg.rest-catalog.oauth2.credential=\${ENV:CLIENT_ID}:\${ENV:CLIENT_SECRET}
iceberg.rest-catalog.oauth2.scope=PRINCIPAL_ROLE:ALL
iceberg.rest-catalog.warehouse=${catalog}
iceberg.rest-catalog.vended-credentials-enabled=true
iceberg.rest-catalog.http-headers=Polaris-Realm: \${ENV:POLARIS_REALM}
fs.s3.enabled=true
s3.endpoint=\${ENV:S3_ENDPOINT}
s3.path-style-access=true
s3.region=\${ENV:S3_REGION}
`;
}

// Arbre schémas -> tables -> colonnes d'un catalogue lié (2 requêtes Trino).
// Toute requête passe par l'executor du rôle actif (compte Trino du rôle,
// contraint par rules.json) — jamais le compte de service BFF.
export interface ColumnInfo {
  name: string;
  type: string;
}
export interface TableNode {
  name: string;
  type: string;
  columns: ColumnInfo[];
}
export interface SchemaNode {
  name: string;
  tables: TableNode[];
}
export interface CatalogTree {
  binding: string;
  schemas: SchemaNode[];
}

export async function loadCatalogTree(
  binding: string,
  run: TrinoExecutor,
): Promise<CatalogTree> {
  const schemasResult = await run(`SHOW SCHEMAS FROM ${quoteIdent(binding)}`);
  const schemas = schemasResult.rows
    .map((r) => String(r[0]))
    .filter((s) => s !== "information_schema")
    .sort();

  if (schemas.length === 0) {
    return { binding, schemas: [] };
  }

  const columnsResult = await run(
    `SELECT table_schema, table_name, column_name, data_type ` +
      `FROM ${quoteIdent(binding)}.information_schema.columns ` +
      `ORDER BY table_schema, table_name, ordinal_position`,
  );

  const tablesIndex = new Map<string, TableNode>();
  const typesResult = await run(
    `SELECT table_schema, table_name, table_type ` +
      `FROM ${quoteIdent(binding)}.information_schema.tables`,
  );
  const typesIndex = new Map<string, string>();
  for (const row of typesResult.rows) {
    typesIndex.set(`${String(row[0])}.${String(row[1])}`, String(row[2]));
  }

  for (const row of columnsResult.rows) {
    const [schema, table, column, dataType] = [
      String(row[0]),
      String(row[1]),
      String(row[2]),
      String(row[3]),
    ];
    const key = `${schema}.${table}`;
    let node = tablesIndex.get(key);
    if (!node) {
      node = {
        name: table,
        type: typesIndex.get(key) ?? "BASE TABLE",
        columns: [],
      };
      tablesIndex.set(key, node);
    }
    node.columns.push({ name: column, type: dataType });
  }

  return {
    binding,
    schemas: schemas.map((schema) => ({
      name: schema,
      tables: [...tablesIndex.entries()]
        .filter(([key]) => key.startsWith(`${schema}.`))
        .map(([, node]) => node)
        .sort((a, b) => a.name.localeCompare(b.name)),
    })),
  };
}

// Métriques d'un catalogue lié : tables, fichiers Iceberg, espace disque.
export interface CatalogStats {
  tables: number;
  files: number;
  bytes: number;
}
export async function computeCatalogStats(
  binding: string,
  run: TrinoExecutor,
): Promise<CatalogStats> {
  const tablesResult = await run(
    `SELECT table_schema, table_name ` +
      `FROM ${quoteIdent(binding)}.information_schema.tables ` +
      `WHERE table_schema <> 'information_schema'`,
  );
  const stats: CatalogStats = { tables: 0, files: 0, bytes: 0 };
  for (const row of tablesResult.rows) {
    const schema = String(row[0]);
    const table = String(row[1]);
    stats.tables += 1;
    try {
      const files = await run(
        `SELECT count(*), coalesce(sum(file_size_in_bytes), 0) ` +
          `FROM ${quoteIdent(binding)}.${quoteIdent(schema)}.${quoteIdent(`${table}$files`)}`,
      );
      stats.files += Number(files.rows[0]?.[0] ?? 0);
      stats.bytes += Number(files.rows[0]?.[1] ?? 0);
    } catch {
      // table non Iceberg ou métadonnées indisponibles : ignorée
    }
  }
  return stats;
}
