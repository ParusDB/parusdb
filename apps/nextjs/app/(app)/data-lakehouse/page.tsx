// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { CatalogsView } from "@/components/lakehouse/catalogs-view";
import { requireSession } from "@/lib/session";
import { can, grantsForActiveRole } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadCatalogViews, computeCatalogStats } from "@/lib/lakehouse";
import { sessionTrinoExecutor } from "@/lib/trino";
import { getTrinoRestartState } from "@/lib/trino-restart";
import type { CatalogEntry } from "@/types/db";

export default async function DataLakehousePage() {
  const session = await requireSession();
  const supabase = await createClient();

  // Registre filtré par la RLS : seuls les catalogues où le rôle actif
  // dispose du privilège « Lecture » (propriété ou grant) apparaissent.
  const { data: registryRows } = await supabase
    .schema("lakehouse")
    .from("catalog_registry")
    .select("catalog_name, description, created_by, owner_role_id, created_at, updated_at");
  const registry = (registryRows ?? []) as unknown as CatalogEntry[];
  const readable = new Set(registry.map((r) => r.catalog_name));

  let polarisError: string | null = null;
  let catalogs: Awaited<ReturnType<typeof loadCatalogViews>> = [];
  try {
    // La fusion Polaris (source de vérité) + registre est restreinte aux
    // catalogues lisibles par le rôle actif.
    catalogs = (await loadCatalogViews(registry)).filter((c) =>
      readable.has(c.name),
    );
  } catch (error) {
    polarisError =
      error instanceof Error ? error.message : "Polaris est injoignable.";
  }

  const grants = await grantsForActiveRole(session).catch(() => []);

  // Métriques globales : tables, fichiers, espace (catalogues liés à Trino)
  // et requêtes exécutées (historique global via le client admin).
  let totalTables = 0;
  let totalFiles = 0;
  let totalBytes = 0;
  let trinoError: string | null = null;
  const bound = catalogs.filter((c) => c.binding);
  try {
    // Métriques sous le compte Trino du rôle actif : seuls les catalogues
    // réellement accessibles (rules.json du rôle) renvoient des chiffres.
    const run = await sessionTrinoExecutor(session);
    const stats = await Promise.all(
      bound.map((c) => computeCatalogStats(c.binding as string, run)),
    );
    for (const s of stats) {
      totalTables += s.tables;
      totalFiles += s.files;
      totalBytes += s.bytes;
    }
  } catch (error) {
    trinoError =
      error instanceof Error ? error.message : "Trino est injoignable.";
  }

  const admin = createAdminClient();
  const { count: queryCount } = await admin
    .schema("lakehouse")
    .from("query_history")
    .select("id", { count: "exact", head: true });

  return (
    <div className="mx-auto max-w-6xl">
      <CatalogsView
        catalogs={catalogs.map((c) => {
          const entry = registry.find((r) => r.catalog_name === c.name);
          return {
            ...c,
            // Suppression : privilège « Gestion » (rôle propriétaire ou
            // grant) — le catalogue système reste intouchable.
            canManage:
              !c.isDefault &&
              can(
                session,
                grants,
                "catalog",
                c.name,
                entry?.owner_role_id ?? null,
                "manage",
              ),
          };
        })}
        metrics={{
          catalogs: catalogs.length,
          tables: totalTables,
          files: totalFiles,
          bytes: totalBytes,
          queries: queryCount ?? 0,
        }}
        polarisError={polarisError}
        trinoError={trinoError}
        boundCount={bound.length}
        trinoRestart={getTrinoRestartState()}
      />
    </div>
  );
}
