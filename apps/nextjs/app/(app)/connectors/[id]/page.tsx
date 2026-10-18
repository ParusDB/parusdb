// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { notFound } from "next/navigation";
import { PageHeader } from "@/components/parus/page-header";
import { PipelineWizard } from "@/components/connectors/pipeline-wizard";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { loadCatalogViews } from "@/lib/lakehouse";
import type { CatalogEntry, Pipeline } from "@/types/db";

export default async function EditPipelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("connectors");
  const { id } = await params;
  const supabase = await createClient();

  const { data: pipeline } = await supabase
    .schema("connectors")
    .from("pipelines")
    .select("id, name, source_type, source_config, selected_tables, write_mode, cron, destination_catalog")
    .eq("id", id)
    .maybeSingle();
  if (!pipeline) notFound();

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

  const row = pipeline as unknown as Pipeline & {
    source_config: { fields?: Record<string, string> };
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Connecteurs ELT"
        title={`Modifier « ${row.name} »`}
        description="Credentials laissés vides : les valeurs chiffrées existantes sont conservées."
      />
      <PipelineWizard
        pipelineId={row.id}
        catalogs={catalogs}
        initial={{
          name: row.name,
          sourceType: row.source_type,
          sourceConfig: row.source_config?.fields ?? {},
          selectedTables: row.selected_tables ?? [],
          writeMode: row.write_mode,
          cron: row.cron,
          destinationCatalog: row.destination_catalog,
        }}
      />
    </div>
  );
}
