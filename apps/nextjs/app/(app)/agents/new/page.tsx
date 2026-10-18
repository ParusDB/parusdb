// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { AgentForm } from "@/components/agents/agent-form";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { listModels } from "@/lib/ollama";

export default async function NewAgentPage() {
  const session = await requirePermission("agents");
  const supabase = await createClient();

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

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Agents IA"
        title="Nouvel agent IA"
        description="Nom, modèle LLM, prompt système et sources : tout est stocké côté serveur, les prompts sont des données."
      />
      <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
        <AgentForm
          ollamaModels={ollamaModels}
          proprietaryModels={proprietary}
          catalogs={catalogs}
        />
      </div>
    </div>
  );
}
