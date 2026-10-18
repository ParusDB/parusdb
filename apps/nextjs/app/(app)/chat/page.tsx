// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { ConversationList } from "@/components/chat/conversation-list";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Conversation } from "@/types/db";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function ChatPage() {
  const session = await requirePermission("chat");
  const supabase = await createClient();
  const { data } = await supabase
    .schema("chat")
    .from("conversations")
    .select("id, title, updated_at, agent_id, agents(name, model_id)")
    .order("updated_at", { ascending: false })
    .limit(100);

  const conversations = (data ?? []) as unknown as (Conversation & {
    updated_at: string;
    agents?: { name: string; model_id: string } | null;
  })[];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Chat IA"
        title="Conversations"
        description="Posez vos questions métier en français : vos agents interrogent le lakehouse et répondent avec les chiffres sourcés."
        actions={
          <Button asChild className="rounded-full bg-jaune font-semibold text-charbon hover:bg-jaune/90">
            <Link href="/chat/new">
              <Plus className="h-4 w-4" strokeWidth={1.8} /> Nouveau chat
            </Link>
          </Button>
        }
      />
      <ConversationList
        conversations={conversations.map((c) => ({
          id: c.id,
          title: c.title,
          updatedAt: c.updated_at,
          agentName: c.agents?.name ?? "Agent",
        }))}
        userName={`${session.profile?.first_name ?? ""} ${session.profile?.last_name ?? ""}`.trim()}
      />
    </div>
  );
}
