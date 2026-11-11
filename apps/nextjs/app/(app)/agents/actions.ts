"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasGrant, requireSession, type SessionContext } from "@/lib/session";
import { deleteGrantsForResource } from "@/lib/rbac";

// Droit requis sur l'agent, avec message français (la RLS reste la garde
// finale côté base).
async function assertGrant(
  session: SessionContext,
  agentId: string,
  privilege: "read" | "write" | "manage",
) {
  const granted = await hasGrant(session.userId, "agent", agentId, privilege);
  if (!granted) {
    throw new Error(
      privilege === "manage"
        ? "Seuls les membres du rôle propriétaire (ou un rôle avec le privilège « Gestion ») peuvent supprimer cet agent."
        : "Votre rôle actif ne permet pas de modifier cet agent (privilège « Écriture » requis).",
    );
  }
}

export interface AgentInput {
  name: string;
  description: string;
  // 'ollama' (serveur local embarqué) ou l'id d'un fournisseur
  // (admin.providers) - jamais un libellé libre.
  model_provider: string;
  model_id: string;
  system_prompt: string;
  sources: string[];
}

// Validation de la source du modèle : elle doit exister au moment de
// l'enregistrement (fournisseur supprimé entre-temps = refus explicite).
async function assertValidProvider(
  supabase: Awaited<ReturnType<typeof createClient>>,
  value: string,
) {
  if (value === "ollama") return;
  // Schéma `admin` explicite : PostgREST ne résout pas les fonctions non
  // qualifiées hors de `public` (PGRST202 sinon).
  const { data, error } = await supabase
    .schema("admin")
    .rpc("list_providers");
  if (error) {
    throw new Error(
      `La vérification de la source du modèle a échoué : ${error.message}`,
    );
  }
  const ids = ((data ?? []) as { id: string }[]).map((p) => p.id);
  if (!ids.includes(value)) {
    throw new Error(
      "La source du modèle n’existe plus (fournisseur supprimé en administration). Choisissez une autre source.",
    );
  }
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
  const session = await requireSession();
  if (!session.activeRole) {
    throw new Error("Aucun rôle actif : impossible de créer un agent.");
  }
  const supabase = await createClient();
  const name = input.name.trim();
  if (!name) throw new Error("Le nom de l'agent est obligatoire.");
  await assertValidProvider(supabase, input.model_provider);

  const { data, error } = await supabase
    .schema("agents")
    .from("agents")
    .insert({
      owner_id: session.userId,
      // Le rôle actif qui crée l'agent en devient propriétaire (RBAC
      // refonte) : tous les comptes portant ce rôle le voient.
      owner_role_id: session.activeRole.id,
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
  const session = await requireSession();
  await assertGrant(session, id, "write");
  const supabase = await createClient();
  const name = input.name.trim();
  if (!name) throw new Error("Le nom de l'agent est obligatoire.");
  await assertValidProvider(supabase, input.model_provider);

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

// Renommage léger (sidebar) : ne touche que le nom, sans naviguer.
export async function renameAgent(id: string, name: string) {
  const session = await requireSession();
  await assertGrant(session, id, "write");
  const supabase = await createClient();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Le nom de l'agent est obligatoire.");
  const { error } = await supabase
    .schema("agents")
    .from("agents")
    .update({ name: trimmed })
    .eq("id", id);
  if (error) {
    throw new Error(`Le renommage a échoué : ${error.message}`);
  }
  revalidatePath("/agents");
  revalidatePath(`/agents/${id}`);
}

export async function deleteAgent(id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  try {
    await assertGrant(session, id, "manage");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "La suppression a échoué." };
  }
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
  // Purge des grants sur l'agent disparu (best effort, has_grant échoue
  // fermé sur ressource inexistante de toute façon).
  await deleteGrantsForResource("agent", id);
  revalidatePath("/agents");
  return { ok: true };
}
