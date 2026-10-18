// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { AgentsGrid } from "@/components/agents/agents-grid";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { Agent } from "@/types/db";

export default async function AgentsPage() {
  const session = await requirePermission("agents");
  const supabase = await createClient();
  const [{ data: agents }, { data: sources }] = await Promise.all([
    supabase
      .schema("agents")
      .from("agents")
      .select("id, owner_id, name, description, model_provider, model_id, system_prompt, created_at, updated_at")
      .order("created_at", { ascending: false }),
    supabase.schema("agents").from("agent_sources").select("agent_id, source_name"),
  ]);

  const rows = (agents ?? []) as unknown as Agent[];
  const sourceMap = new Map<string, string[]>();
  for (const s of (sources ?? []) as { agent_id: string; source_name: string }[]) {
    const list = sourceMap.get(s.agent_id) ?? [];
    list.push(s.source_name);
    sourceMap.set(s.agent_id, list);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Agents IA"
        title="Vos agents"
        description="Chaque agent combine un modèle LLM, un prompt système et des sources de connaissances (catalogues du lakehouse autorisés à votre rôle actif)."
        actions={
          <Button asChild className="rounded-full bg-jaune font-semibold text-charbon hover:bg-jaune/90">
            <Link href="/agents/new">
              <Plus className="h-4 w-4" strokeWidth={1.8} /> Nouvel agent IA
            </Link>
          </Button>
        }
      />
      <AgentsGrid
        agents={rows.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          provider: a.model_provider,
          model: a.model_id,
          sources: sourceMap.get(a.id) ?? [],
          isOwner: a.owner_id === session.userId,
        }))}
      />
    </div>
  );
}
