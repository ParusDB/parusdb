// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fetchProviderLabels, providerLabel } from "@/lib/providers";
import { NewChat } from "@/components/chat/new-chat";
import { CharbonPanel } from "@/components/parus/charbon-panel";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function NewChatPage() {
  await requireSession();
  const supabase = await createClient();
  // Les agents visibles sont ceux où le rôle actif dispose du privilège
  // « Lecture » (RLS agents_select_perm).
  const [{ data: agents }, providerLabels] = await Promise.all([
    supabase
      .schema("agents")
      .from("agents")
      .select("id, name, description, model_provider, model_id")
      .order("created_at", { ascending: true })
      .limit(100),
    fetchProviderLabels(supabase).catch(() => new Map<string, string>()),
  ]);

  if (!agents || agents.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <CharbonPanel size="lg" className="text-center">
          <h1 className="font-display text-3xl">Aucun agent disponible</h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-blanc/70">
            Pour discuter avec vos données, il faut d’abord un agent IA.
            Créez-en un, ou demandez à un administrateur de partager un agent
            avec votre rôle.
          </p>
          <Button
            asChild
            className="mt-6 rounded-full bg-jaune font-semibold text-charbon shadow-[0_20px_60px_-20px_rgba(255,215,0,0.5)] transition-transform hover:-translate-y-0.5"
          >
            <Link href="/agents/new">Créer un agent IA</Link>
          </Button>
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
        model: `${providerLabel(a.model_provider, providerLabels)}/${a.model_id}`,
      }))}
    />
  );
}
