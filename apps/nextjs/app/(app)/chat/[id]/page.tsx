// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fetchProviderLabels, providerLabel } from "@/lib/providers";
import { ConversationView } from "@/components/chat/conversation-view";
import type { Conversation, Message } from "@/types/db";

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pending?: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const { pending } = await searchParams;
  const supabase = await createClient();

  const { data: conversation } = await supabase
    .schema("chat")
    .from("conversations")
    .select("id, title, agent_id, owner_id")
    .eq("id", id)
    .maybeSingle();

  // RLS : le propriétaire et les rôles bénéficiaires d'un partage voient la
  // conversation - les partages sont en lecture seule.
  if (!conversation) notFound();

  // Partages existants : visibles par le propriétaire (granted_by) - l'UI de
  // partage n'est proposée qu'au propriétaire.
  const owned = conversation.owner_id === session.userId;
  let shares: { roleId: string; roleName: string }[] = [];
  if (owned) {
    const { data: shareRows } = await supabase
      .schema("chat")
      .from("conversation_shares")
      .select("role_id")
      .eq("conversation_id", id);
    const roleMap = new Map(session.roles.map((r) => [r.id, r.name]));
    shares = (shareRows ?? []).map((s: { role_id: string }) => ({
      roleId: s.role_id,
      roleName: roleMap.get(s.role_id) ?? "Rôle",
    }));
  }

  // Agent lié (requête séparée : PostgREST ne joint pas cross-schema avec
  // la syntaxe `agents(...)` depuis le schéma `chat`).
  const { data: agent } = await supabase
    .schema("agents")
    .from("agents")
    .select("id, name, description, model_provider, model_id")
    .eq("id", conversation.agent_id)
    .maybeSingle();

  const { data: messages } = await supabase
    .schema("chat")
    .from("messages")
    .select("id, conversation_id, role, content, metadata, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(200);

  const providerLabels = await fetchProviderLabels(supabase).catch(
    () => new Map<string, string>(),
  );

  const conv = conversation as unknown as Conversation;

  return (
    <ConversationView
      conversation={{
        id: conv.id,
        title: conv.title,
        agentId: conv.agent_id,
        agentName: (agent as { name?: string } | null)?.name ?? "Agent IA",
        model: `${providerLabel(
          (agent as { model_provider?: string } | null)?.model_provider,
          providerLabels,
        )}/${(agent as { model_id?: string } | null)?.model_id ?? ""}`,
      }}
      owned={owned}
      shares={shares}
      shareableRoles={session.roles.map((r) => ({
        id: r.id,
        name: r.name,
      }))}
      initialMessages={(messages ?? []) as unknown as Message[]}
      pendingMessage={pending ?? null}
    />
  );
}
