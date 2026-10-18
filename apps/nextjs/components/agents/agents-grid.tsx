"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CharbonPanel } from "@/components/parus/charbon-panel";
import { ParusLogo } from "@/components/parus/logo";
import { ConfirmNameDialog } from "@/components/parus/confirm-name-dialog";
import { deleteAgent } from "@/app/(app)/agents/actions";

export interface AgentCardData {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  model: string;
  sources: string[];
  isOwner: boolean;
}

export function AgentsGrid({ agents }: { agents: AgentCardData[] }) {
  const router = useRouter();

  if (agents.length === 0) {
    return (
      <CharbonPanel className="text-center">
        <div className="flex justify-center">
          <ParusLogo />
        </div>
        <h2 className="mt-6 font-display text-2xl">Aucun agent pour l’instant</h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-blanc/70">
          Un agent IA est un modèle, un prompt système et des sources. Créez-en
          un pour interroger le lakehouse en langage naturel.
        </p>
        <Button
          asChild
          className="mt-6 rounded-full bg-jaune font-semibold text-charbon shadow-[0_20px_60px_-20px_rgba(255,215,0,0.5)] transition-transform hover:-translate-y-0.5"
        >
          <Link href="/agents/new">Créer un agent IA</Link>
        </Button>
      </CharbonPanel>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
      {agents.map((agent) => (
        <div
          key={agent.id}
          className="group flex flex-col rounded-3xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:border-charbon hover:shadow-[0_24px_60px_-30px_rgba(26,26,26,0.35)]"
        >
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-jaune text-charbon">
            <Bot className="h-6 w-6" strokeWidth={1.6} />
          </div>
          <h3 className="font-display text-xl">{agent.name}</h3>
          <p className="mono mt-1 text-xs text-muted-foreground">
            {agent.provider} · {agent.model}
          </p>
          <p className="mt-2.5 line-clamp-3 min-h-10 text-sm text-muted-foreground">
            {agent.description ?? "Aucune description."}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {agent.sources.length > 0 ? (
              agent.sources.slice(0, 3).map((s) => (
                <Badge key={s} variant="outline" className="mono text-[10px] font-normal">
                  {s}
                </Badge>
              ))
            ) : (
              <span className="mono text-[10px] text-muted-foreground">
                Aucune source
              </span>
            )}
            {agent.sources.length > 3 ? (
              <Badge variant="outline" className="mono text-[10px] font-normal">
                +{agent.sources.length - 3}
              </Badge>
            ) : null}
          </div>
          <div className="mt-5 flex items-center gap-1.5 border-t border-border pt-4">
            <Button asChild variant="outline" size="sm" className="flex-1">
              <Link href={`/agents/${agent.id}`}>
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.6} /> Modifier
              </Link>
            </Button>
            <ConfirmNameDialog
              title="Supprimer cet agent ?"
              description={`Toutes les sources associées à « ${agent.name} » seront détachées. Les conversations existantes sont conservées et l’agent ne pourra plus être supprimé tant qu’elles y font référence.`}
              expectedName={agent.name}
              trigger={
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="hover:text-destructive"
                  aria-label={`Supprimer l’agent ${agent.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
                </Button>
              }
              action={async () => {
                const result = await deleteAgent(agent.id);
                if (result.ok) router.refresh();
                return result;
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
