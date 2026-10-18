// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ConversationView } from "@/components/chat/conversation-view";
import type { Agent, Conversation, Message } from "@/types/db";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("chat");
  const { id } = await params;
  const supabase = await createClient();

  const { data: conversation } = await supabase
    .schema("chat")
    .from("conversations")
    .select("id, title, agent_id, agents(id, name, description, model_provider, model_id)")
    .eq("id", id)
    .maybeSingle();

  // RLS : seul le propriétaire voit la conversation.
  if (!conversation) notFound();

  const { data: messages } = await supabase
    .schema("chat")
    .from("messages")
    .select("id, conversation_id, role, content, metadata, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(200);

  const conv = conversation as unknown as Conversation & {
    agents: Pick<Agent, "id" | "name" | "model_provider" | "model_id"> | null;
  };

  return (
    <ConversationView
      conversation={{
        id: conv.id,
        title: conv.title,
        agentId: conv.agent_id,
        agentName: conv.agents?.name ?? "Agent IA",
        model: `${conv.agents?.model_provider ?? "ollama"}/${conv.agents?.model_id ?? ""}`,
      }}
      initialMessages={(messages ?? []) as unknown as Message[]}
    />
  );
}
