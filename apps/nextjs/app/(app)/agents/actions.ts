"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/session";

export interface AgentInput {
  name: string;
  description: string;
  model_provider: "ollama" | "openai" | "anthropic" | "mistral" | "custom";
  model_id: string;
  system_prompt: string;
  sources: string[];
}

async function writeSources(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agentId: string,
  sources: string[],
) {
  const { error: deleteError } = await supabase
    .schema("agents")
    .from("agent_sources")
    .delete()
    .eq("agent_id", agentId);
  if (deleteError) {
    throw new Error(
      `La mise à jour des sources a échoué : ${deleteError.message}`,
    );
  }
  if (sources.length === 0) return;
  const { error: insertError } = await supabase
    .schema("agents")
    .from("agent_sources")
    .insert(
      sources.map((source) => ({
        agent_id: agentId,
        source_type: "catalog",
        source_name: source,
      })),
    );
  if (insertError) {
    throw new Error(
      `La mise à jour des sources a échoué : ${insertError.message}`,
    );
  }
}

export async function createAgent(input: AgentInput) {
  const session = await requirePermission("agents");
  const supabase = await createClient();
  const name = input.name.trim();
  if (!name) throw new Error("Le nom de l'agent est obligatoire.");

  const { data, error } = await supabase
    .schema("agents")
    .from("agents")
    .insert({
      owner_id: session.userId,
      name,
      description: input.description.trim() || null,
      model_provider: input.model_provider,
      model_id: input.model_id,
      system_prompt: input.system_prompt,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `La création de l'agent a échoué : ${error?.message ?? "erreur inattendue"}`,
    );
  }
  await writeSources(supabase, data.id, input.sources);
  revalidatePath("/agents");
  redirect(`/agents`);
}

export async function updateAgent(id: string, input: AgentInput) {
  await requirePermission("agents");
  const supabase = await createClient();
  const name = input.name.trim();
  if (!name) throw new Error("Le nom de l'agent est obligatoire.");

  const { error } = await supabase
    .schema("agents")
    .from("agents")
    .update({
      name,
      description: input.description.trim() || null,
      model_provider: input.model_provider,
      model_id: input.model_id,
      system_prompt: input.system_prompt,
    })
    .eq("id", id);
  if (error) {
    throw new Error(`La mise à jour a échoué : ${error.message}`);
  }
  await writeSources(supabase, id, input.sources);
  revalidatePath("/agents");
  revalidatePath(`/agents/${id}`);
  redirect(`/agents`);
}

export async function deleteAgent(id: string): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("agents");
  const supabase = await createClient();
  const { error } = await supabase
    .schema("agents")
    .from("agents")
    .delete()
    .eq("id", id);
  if (error) {
    const restricted = error.code === "23503";
    return {
      ok: false,
      error: restricted
        ? "Impossible de supprimer : des conversations font référence à cet agent. Supprimez-les d'abord."
        : `La suppression a échoué : ${error.message}`,
    };
  }
  revalidatePath("/agents");
  return { ok: true };
}
