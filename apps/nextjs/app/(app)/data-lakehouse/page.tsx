// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { CatalogsView } from "@/components/lakehouse/catalogs-view";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadCatalogViews, computeCatalogStats } from "@/lib/lakehouse";
import { getTrinoRestartState } from "@/lib/trino-restart";
import type { CatalogEntry } from "@/types/db";

export default async function DataLakehousePage() {
  const session = await requirePermission("lakehouse");
  const supabase = await createClient();

  const { data: registryRows } = await supabase
    .schema("lakehouse")
    .from("catalog_registry")
    .select("catalog_name, description, created_by, created_at, updated_at");
  const registry = (registryRows ?? []) as unknown as CatalogEntry[];

  let polarisError: string | null = null;
  let catalogs: Awaited<ReturnType<typeof loadCatalogViews>> = [];
  try {
    catalogs = await loadCatalogViews(registry);
  } catch (error) {
    polarisError =
      error instanceof Error ? error.message : "Polaris est injoignable.";
  }

  // Métriques globales : tables, fichiers, espace (catalogues liés à Trino)
  // et requêtes exécutées (historique global via le client admin).
  let totalTables = 0;
  let totalFiles = 0;
  let totalBytes = 0;
  let trinoError: string | null = null;
  const bound = catalogs.filter((c) => c.binding);
  try {
    const stats = await Promise.all(
      bound.map((c) => computeCatalogStats(c.binding as string)),
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
        catalogs={catalogs}
        metrics={{
          catalogs: catalogs.length,
          tables: totalTables,
          files: totalFiles,
          bytes: totalBytes,
          queries: queryCount ?? 0,
        }}
        polarisError={polarisError}
        trinoError={trinoError}
        isAdmin={session.has("admin.users")}
        boundCount={bound.length}
        trinoRestart={getTrinoRestartState()}
      />
    </div>
  );
}
