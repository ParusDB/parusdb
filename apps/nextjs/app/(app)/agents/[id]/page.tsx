// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { notFound } from "next/navigation";
import { PageHeader } from "@/components/parus/page-header";
import { AgentForm } from "@/components/agents/agent-form";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { listModelSources } from "@/lib/providers";
import type { Agent } from "@/types/db";

export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePermission("agents");
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: agent }, { data: sourceRows }] = await Promise.all([
    supabase.schema("agents").from("agents").select("*").eq("id", id).maybeSingle(),
    supabase.schema("agents").from("agent_sources").select("source_name").eq("agent_id", id),
  ]);
  if (!agent) notFound();

  const [modelSources, catalogs] = await Promise.all([
    listModelSources(),
    session.activeRole
      ? Promise.all([
          supabase
            .schema("lakehouse")
            .from("catalog_registry")
            .select("catalog_name")
            .order("catalog_name"),
          supabase
            .schema("lakehouse")
            .from("catalog_access")
            .select("catalog_name")
            .eq("role_id", session.activeRole.id),
        ]).then(([registryRes, accessRes]) => {
          const all = (registryRes.data ?? []).map(
            (r: { catalog_name: string }) => r.catalog_name,
          );
          const accessRows = accessRes.data ?? [];
          // Si le rôle a des entrées catalog_access, filtrer ; sinon tous les
          // catalogues du registre sont accessibles (fallback pour les
          // catalogues créés avant la mise en place de catalog_access).
          if (accessRows.length === 0) return all;
          const allowed = new Set(
            accessRows.map((r: { catalog_name: string }) => r.catalog_name),
          );
          return all.filter((c) => allowed.has(c));
        })
      : Promise.resolve([]),
  ]);

  const row = agent as unknown as Agent;
  const sources = ((sourceRows ?? []) as { source_name: string }[]).map(
    (s) => s.source_name,
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Agents IA"
        title={`Modifier « ${row.name} »`}
        description="Les conversations existantes conservent leur agent : la modification ne s'applique qu'aux nouveaux échanges."
      />
      <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
        <AgentForm
          agentId={row.id}
          initial={{
            name: row.name,
            description: row.description ?? "",
            model_provider: row.model_provider,
            model_id: row.model_id,
            system_prompt: row.system_prompt,
            sources,
          }}
          modelSources={modelSources}
          catalogs={catalogs}
        />
      </div>
    </div>
  );
}
