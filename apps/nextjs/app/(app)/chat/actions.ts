"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";

// Création d'une conversation : l'agent est immuable ensuite (spec §Chat).
export async function createConversation(agentId: string): Promise<string> {
  const session = await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("chat")
    .from("conversations")
    .insert({ owner_id: session.userId, agent_id: agentId })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `La création de la conversation a échoué : ${error?.message ?? "erreur inattendue"}`,
    );
  }
  revalidatePath("/chat");
  return data.id;
}

export async function renameConversation(id: string, title: string) {
  const session = await requireSession();
  const supabase = await createClient();
  const trimmed = title.trim();
  if (!trimmed) {
    throw new Error("Le titre ne peut pas être vide.");
  }
  const { error } = await supabase
    .schema("chat")
    .from("conversations")
    .update({ title: trimmed.slice(0, 120) })
    .eq("id", id)
    .eq("owner_id", session.userId);
  if (error) {
    throw new Error(`Le renommage a échoué : ${error.message}`);
  }
  revalidatePath("/chat");
  revalidatePath(`/chat/${id}`);
}

export async function deleteConversation(id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const supabase = await createClient();
  const { error } = await supabase
    .schema("chat")
    .from("conversations")
    .delete()
    .eq("id", id)
    .eq("owner_id", session.userId);
  if (error) {
    return { ok: false, error: `La suppression a échoué : ${error.message}` };
  }
  revalidatePath("/chat");
  redirect("/chat");
}

// ---------------------------------------------------------------------------
// Partage de conversation (RBAC refonte — docs/functional/rbac_refonte.md) :
// le propriétaire autorise l'accès en LECTURE SEULE aux comptes partageant
// l'un de ses rôles. Révocable à tout moment.
// ---------------------------------------------------------------------------

export async function shareConversation(
  conversationId: string,
  roleId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (!session.roles.some((r) => r.id === roleId)) {
    return {
      ok: false,
      error: "Vous ne portez pas ce rôle : impossible de partager la conversation avec lui.",
    };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .schema("chat")
    .from("conversation_shares")
    .insert({
      conversation_id: conversationId,
      role_id: roleId,
      granted_by: session.userId,
    });
  if (error) {
    if (error.code === "23505") {
      return { ok: true };
    }
    return {
      ok: false,
      error: `Le partage a échoué : ${error.message}`,
    };
  }
  revalidatePath(`/chat/${conversationId}`);
  return { ok: true };
}

export async function unshareConversation(
  conversationId: string,
  roleId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const supabase = await createClient();
  const { error } = await supabase
    .schema("chat")
    .from("conversation_shares")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("role_id", roleId)
    .eq("granted_by", session.userId);
  if (error) {
    return {
      ok: false,
      error: `La révocation a échoué : ${error.message}`,
    };
  }
  revalidatePath(`/chat/${conversationId}`);
  return { ok: true };
}
