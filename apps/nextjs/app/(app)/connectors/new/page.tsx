// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { PipelineWizard } from "@/components/connectors/pipeline-wizard";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { loadCatalogViews } from "@/lib/lakehouse";
import type { CatalogEntry } from "@/types/db";

export default async function NewPipelinePage() {
  await requirePermission("connectors");
  const supabase = await createClient();
  const { data: registryRows } = await supabase
    .schema("lakehouse")
    .from("catalog_registry")
    .select("catalog_name, description, created_by, created_at, updated_at");
  const registry = (registryRows ?? []) as unknown as CatalogEntry[];
  let catalogs: string[] = [];
  try {
    catalogs = (await loadCatalogViews(registry)).map((c) => c.name);
  } catch {
    catalogs = registry.map((r) => r.catalog_name);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Connecteurs ELT"
        title="Connecter une source"
        description="Quatre étapes : source, credentials avec test de connexion, sélection des données, enregistrement."
      />
      <PipelineWizard catalogs={catalogs} />
    </div>
  );
}
