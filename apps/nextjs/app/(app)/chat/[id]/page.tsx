// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ConversationView } from "@/components/chat/conversation-view";
import type { Conversation, Message } from "@/types/db";

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pending?: string }>;
}) {
  await requirePermission("chat");
  const { id } = await params;
  const { pending } = await searchParams;
  const supabase = await createClient();

  const { data: conversation } = await supabase
    .schema("chat")
    .from("conversations")
    .select("id, title, agent_id")
    .eq("id", id)
    .maybeSingle();

  // RLS : seul le propriétaire voit la conversation.
  if (!conversation) notFound();

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

  const conv = conversation as unknown as Conversation;

  return (
    <ConversationView
      conversation={{
        id: conv.id,
        title: conv.title,
        agentId: conv.agent_id,
        agentName: (agent as { name?: string } | null)?.name ?? "Agent IA",
        model: `${(agent as { model_provider?: string } | null)?.model_provider ?? "ollama"}/${(agent as { model_id?: string } | null)?.model_id ?? ""}`,
      }}
      initialMessages={(messages ?? []) as unknown as Message[]}
      pendingMessage={pending ?? null}
    />
  );
}
