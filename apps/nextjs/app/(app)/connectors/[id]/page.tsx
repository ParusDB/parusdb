// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { notFound } from "next/navigation";
import { PageHeader } from "@/components/parus/page-header";
import { PipelineWizard } from "@/components/connectors/pipeline-wizard";
import { requireGrant } from "@/lib/session";
import { writableCatalogNames } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

export default async function EditPipelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Édition d'un pipeline : privilège « Écriture » requis sur le rôle actif
  // (propriété ou grant).
  const { id } = await params;
  const session = await requireGrant("pipeline", id, "write");
  const supabase = await createClient();

  const { data: pipeline } = await supabase
    .schema("connectors")
    .from("pipelines")
    .select(
      "id, name, source_type, source_config, selected_tables, write_mode, cron, destination_catalog, destination_schema",
    )
    .eq("id", id)
    .maybeSingle();
  if (!pipeline) notFound();

  // Destinations possibles : catalogues en « Écriture » pour le rôle actif.
  const catalogs = await writableCatalogNames(session).catch(
    () => [] as string[],
  );

  const row = pipeline as {
    id: string;
    name: string;
    source_type: string;
    source_config: { cursors?: Record<string, string> } | Record<string, unknown>;
    selected_tables: string[];
    write_mode: "incremental" | "replace";
    cron: string;
    destination_catalog: string;
    destination_schema: string | null;
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Connecteurs ELT"
        title={`Modifier « ${row.name} »`}
        description="Credentials laissés vides : les valeurs chiffrées existantes sont conservées. Renseignez de nouveau pour les remplacer."
      />
      <PipelineWizard
        pipelineId={row.id}
        catalogs={catalogs}
        initial={{
          name: row.name,
          sourceType: row.source_type,
          // Credentials volontairement absents : jamais renvoyés au client.
          selectedTables: row.selected_tables ?? [],
          cursors:
            (row.source_config as { cursors?: Record<string, string> })?.cursors ??
            {},
          writeMode: row.write_mode,
          cron: row.cron,
          destinationCatalog: row.destination_catalog,
          destinationSchema: row.destination_schema ?? "",
        }}
      />
    </div>
  );
}
