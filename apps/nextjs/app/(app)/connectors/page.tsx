// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { PipelinesTable } from "@/components/connectors/pipelines-table";
import { RunsPanel } from "@/components/connectors/runs-panel";
import { requireSession } from "@/lib/session";
import { can, grantsForActiveRole, readableCatalogNames } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import type { Pipeline } from "@/types/db";
import { findSource } from "@/lib/sources";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function ConnectorsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const session = await requireSession();
  const supabase = await createClient();
  const { created } = await searchParams;

  // Pipelines : visibles si le rôle actif est propriétaire ou bénéficiaire
  // d'un grant (RLS pipelines_select_perm).
  const [{ data: pipelines }, grants, catalogs] = await Promise.all([
    supabase
      .schema("connectors")
      .from("pipelines")
      .select("id, owner_id, owner_role_id, name, source_type, destination_catalog, destination_schema, status, cron, last_run_at, created_at, updated_at")
      .order("created_at", { ascending: false }),
    grantsForActiveRole(session).catch(() => []),
    readableCatalogNames().catch(() => [] as string[]),
  ]);

  const rows = (pipelines ?? []) as Pipeline[];

  const { data: runRows } = await supabase
    .schema("connectors")
    .from("pipeline_runs")
    .select(
      "id, pipeline_id, pipelines!inner(name), status, trigger, message, rows_loaded, started_at, finished_at",
    )
    .order("started_at", { ascending: false })
    .limit(20);
  const runs = (runRows ?? []).map((run: unknown) => {
    const row = run as {
      id: string;
      pipeline_id: string;
      pipelines: { name: string }[] | { name: string };
      status: "queued" | "running" | "success" | "error";
      trigger: "creation" | "manual" | "schedule";
      message: string | null;
      rows_loaded: number | null;
      started_at: string;
      finished_at: string | null;
    };
    const pipeline = Array.isArray(row.pipelines)
      ? row.pipelines[0]
      : row.pipelines;
    return {
      id: row.id,
      pipeline_id: row.pipeline_id,
      pipeline_name: pipeline?.name ?? "—",
      status: row.status,
      trigger: row.trigger,
      message: row.message,
      rows_loaded: row.rows_loaded,
      started_at: row.started_at,
      finished_at: row.finished_at,
    };
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8">
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
      {created ? (
        <p className="rounded-lg border border-olive/40 bg-olive/10 px-4 py-3 text-sm text-olive">
          Pipeline enregistré : la première exécution est en file — l’historique
          ci-dessous se met à jour automatiquement.
        </p>
      ) : null}
      <PipelinesTable
        pipelines={rows.map((p) => ({
          ...p,
          sourceLabel: findSource(p.source_type)?.label ?? p.source_type,
          canEdit: can(session, grants, "pipeline", p.id, p.owner_role_id, "write"),
          canDelete: can(session, grants, "pipeline", p.id, p.owner_role_id, "manage"),
        }))}
        catalogs={catalogs}
      />
      <section className="space-y-3">
        <h2 className="font-display text-lg">Historique des exécutions</h2>
        <RunsPanel runs={runs} />
      </section>
    </div>
  );
}
