// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { PipelinesTable } from "@/components/connectors/pipelines-table";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { loadCatalogViews } from "@/lib/lakehouse";
import type { CatalogEntry } from "@/types/db";
import { findSource } from "@/lib/sources";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function ConnectorsPage() {
  const session = await requirePermission("connectors");
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

  const { data: pipelines } = await supabase
    .schema("connectors")
    .from("pipelines")
    .select("id, owner_id, name, source_type, destination_catalog, status, cron, last_run_at, created_at, updated_at")
    .order("created_at", { ascending: false });

  const rows = (pipelines ?? []) as {
    id: string;
    owner_id: string;
    name: string;
    source_type: string;
    destination_catalog: string;
    status: "active" | "inactive" | "error";
    cron: string;
    last_run_at: string | null;
    created_at: string;
  }[];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Connecteurs ELT"
        title="Pipelines d'ingestion"
        description="Un pipeline charge les données d'une source vers un catalogue du Data Lakehouse. Destination unique : le lakehouse, jamais ailleurs."
        actions={
          <Button asChild className="rounded-full bg-jaune font-semibold text-charbon hover:bg-jaune/90">
            <Link href="/connectors/new">
              <Plus strokeWidth={1.8} /> Connecter une source
            </Link>
          </Button>
        }
      />
      <PipelinesTable
        pipelines={rows.map((p) => ({
          ...p,
          sourceLabel: findSource(p.source_type)?.label ?? p.source_type,
          isOwner: p.owner_id === session.userId,
        }))}
        catalogs={catalogs}
      />
    </div>
  );
}
