// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { ConversationList } from "@/components/chat/conversation-list";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function ChatPage() {
  const session = await requirePermission("chat");
  const supabase = await createClient();

  // Jointure cross-schema impossible via PostgREST (AGENTS.md §7) :
  // deux requêtes séparées, fusion ici.
  const [conversationsRes, agentsRes] = await Promise.all([
    supabase
      .schema("chat")
      .from("conversations")
      .select("id, title, updated_at, agent_id")
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase.schema("agents").from("agents").select("id, name"),
  ]);

  const agentNames = new Map(
    (agentsRes.data ?? []).map((a: { id: string; name: string }) => [a.id, a.name]),
  );

  const conversations = (conversationsRes.data ?? []).map(
    (c: { id: string; title: string | null; updated_at: string; agent_id: string }) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updated_at,
      agentName: agentNames.get(c.agent_id) ?? "Agent",
    }),
  );

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
        conversations={conversations}
        userName={`${session.profile?.first_name ?? ""} ${session.profile?.last_name ?? ""}`.trim()}
      />
    </div>
  );
}
