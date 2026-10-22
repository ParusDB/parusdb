"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CharbonPanel } from "@/components/parus/charbon-panel";
import { ParusLogo } from "@/components/parus/logo";
import { createConversation } from "@/app/(app)/chat/actions";

export interface NewChatAgent {
  id: string;
  name: string;
  description: string | null;
  model: string;
}

// État initial d’une conversation (spec §Chat) : logo centré, choix de
// l’agent (immuable ensuite) et zone de saisie.
export function NewChat({ agents }: { agents: NewChatAgent[] }) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleSend() {
    const content = message.trim();
    if (!content || !agentId || pending) return;
    setPending(true);
    try {
      const conversationId = await createConversation(agentId);
      // Le premier message transite par l'URL (?pending=) : la page
      // /chat/[id] le lit côté serveur et le passe à ConversationView.
      // Plus fiable qu'un store mémoire (pas de risque de module réinstancié).
      router.push(
        `/chat/${conversationId}?pending=${encodeURIComponent(content)}`,
      );
    } catch (error) {
      setPending(false);
      throw error;
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center">
      <CharbonPanel size="lg" className="w-full">
        <div className="flex flex-col items-center text-center">
          <ParusLogo />
          <h1 className="mt-8 font-display text-4xl leading-tight text-balance">
            Parlez à vos données.
            <br />
            Elles vous répondront.
          </h1>
          <p className="mono mt-4 text-xs uppercase tracking-[0.2em] text-jaune">
            {agents.length} agent{agents.length > 1 ? "s" : ""} disponible
            {agents.length > 1 ? "s" : ""}
          </p>
        </div>

        <div className="mx-auto mt-10 flex w-full max-w-xl flex-col gap-3">
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger className="w-full border-white/20 bg-white/5 text-blanc">
              <SelectValue placeholder="Choisir un agent IA" />
            </SelectTrigger>
            <SelectContent>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} · {a.model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="min-h-5 text-xs text-blanc/60">
            {agents.find((a) => a.id === agentId)?.description ??
              "L’agent ne peut plus être changé après le premier message."}
          </p>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Ex. : Quel est mon chiffre d’affaires sur les 3 derniers mois ?"
            className="min-h-24 border-white/20 bg-white/5 text-blanc placeholder:text-blanc/40"
            aria-label="Votre question"
          />
          <Button
            onClick={() => void handleSend()}
            disabled={pending || message.trim().length === 0}
            className="w-full rounded-full bg-jaune font-semibold text-charbon shadow-[0_20px_60px_-20px_rgba(255,215,0,0.5)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {pending ? "Ouverture…" : "Envoyer"}
            <Send className="h-4 w-4" strokeWidth={1.8} />
          </Button>
        </div>
      </CharbonPanel>
    </div>
  );
}
