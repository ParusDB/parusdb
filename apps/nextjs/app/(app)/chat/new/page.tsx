// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { NewChat } from "@/components/chat/new-chat";
import { CharbonPanel } from "@/components/parus/charbon-panel";
import { ParusLogo } from "@/components/parus/logo";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function NewChatPage() {
  const session = await requirePermission("chat");
  const supabase = await createClient();
  const { data: agents } = await supabase
    .schema("agents")
    .from("agents")
    .select("id, name, description, model_provider, model_id")
    .order("created_at", { ascending: true })
    .limit(100);

  if (!agents || agents.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <CharbonPanel size="lg" className="text-center">
          <div className="flex justify-center">
            <ParusLogo />
          </div>
          <h1 className="mt-6 font-display text-3xl">Aucun agent disponible</h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-blanc/70">
            Pour discuter avec vos données, il faut d’abord un agent IA. Les
            utilisateurs disposant de la permission « Agents IA » peuvent en
            créer un.
          </p>
          {session.has("agents") ? (
            <Button
              asChild
              className="mt-6 rounded-full bg-jaune font-semibold text-charbon shadow-[0_20px_60px_-20px_rgba(255,215,0,0.5)] transition-transform hover:-translate-y-0.5"
            >
              <Link href="/agents/new">Créer un agent IA</Link>
            </Button>
          ) : null}
        </CharbonPanel>
      </div>
    );
  }

  return (
    <NewChat
      agents={agents.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        model: `${a.model_provider}/${a.model_id}`,
      }))}
    />
  );
}
