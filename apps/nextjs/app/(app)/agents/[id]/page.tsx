// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { notFound } from "next/navigation";
import { PageHeader } from "@/components/parus/page-header";
import { AgentForm } from "@/components/agents/agent-form";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { listModels } from "@/lib/ollama";
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

  const [ollamaModels, proprietary, catalogs] = await Promise.all([
    listModels().then((m) => m.map((x) => x.name)).catch(() => []),
    supabase.rpc("list_proprietary_models").then(({ data }) =>
      ((data ?? []) as { provider: string; model: string }[]).map((m) => ({
        provider: m.provider,
        model: m.model,
      })),
    ),
    session.activeRole
      ? supabase
          .schema("lakehouse")
          .from("catalog_access")
          .select("catalog_name")
          .eq("role_id", session.activeRole.id)
          .order("catalog_name")
          .then(({ data }) => (data ?? []).map((c: { catalog_name: string }) => c.catalog_name))
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
          ollamaModels={ollamaModels}
          proprietaryModels={proprietary}
          catalogs={catalogs}
        />
      </div>
    </div>
  );
}
