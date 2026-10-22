"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Pencil, Send, Terminal, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ParusLogo } from "@/components/parus/logo";
import {
  deleteConversation,
  renameConversation,
} from "@/app/(app)/chat/actions";
import type { Message } from "@/types/db";

// Diffusion temps réel via **Supabase Realtime** (spec §Chat / §Notes) : le
// BFF insère les évènements dans chat.stream_events, le navigateur s'y
// abonne (postgres_changes filtrés par conversation, protégés par RLS).
interface StreamEventPayload {
  label?: string | null;
  tool?: string | null;
  query?: string | null;
  ok?: boolean;
  text?: string | null;
  message?: string | null;
  error?: string | null;
  messageId?: string | null;
  title?: string | null;
}

export interface ConversationViewProps {
  conversation: {
    id: string;
    title: string | null;
    agentId: string;
    agentName: string;
    model: string;
  };
  initialMessages: Message[];
  /** Premier message passé par /chat/new via ?pending= — envoyé au montage. */
  pendingMessage?: string | null;
}

export function ConversationView({
  conversation,
  initialMessages,
  pendingMessage,
}: ConversationViewProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [toolTrace, setToolTrace] = useState<
    { tool: string; query?: string; ok?: boolean }[]
  >([]);
  const [streamText, setStreamText] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(conversation.title ?? "");
  const bottomRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const readyRef = useRef<Promise<void> | null>(null);
  const streamingRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, streamText, scrollToBottom]);

  const finalize = useCallback(
    (text: string) => {
      // Garde anti-double : le message final peut arriver par deux canaux
      // (évènement Realtime « done » + filet de sécurité HTTP). Un seul
      // les deux ne doivent pas ajouter deux messages identiques.
      if (!streamingRef.current) return;
      streamingRef.current = false;
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          conversation_id: conversation.id,
          role: "assistant",
          content: text,
          metadata: {},
          created_at: new Date().toISOString(),
        },
      ]);
      setStreamText("");
      setStatus(null);
      setToolTrace([]);
      setStreaming(false);
      router.refresh();
    },
    [conversation.id, router],
  );

  const handleStreamEvent = useCallback(
    (kind: string, payload: StreamEventPayload) => {
      if (kind === "status") {
        setStatus(payload.label ?? null);
      } else if (kind === "tool") {
        setToolTrace((prev) => [
          ...prev,
          { tool: payload.tool ?? "", query: payload.query ?? undefined },
        ]);
        setStatus(`Outil ${payload.tool}…`);
      } else if (kind === "tool_result") {
        setToolTrace((prev) =>
          prev.map((t, i) =>
            i === prev.length - 1 ? { ...t, ok: payload.ok ?? true } : t,
          ),
        );
      } else if (kind === "token") {
        setStatus(null);
        setStreamText((prev) => prev + (payload.text ?? ""));
      } else if (kind === "error") {
        toast.error(payload.message ?? "L'agent n'a pas pu répondre.");
      } else if (kind === "done") {
        finalize(payload.text ?? "");
      }
    },
    [finalize],
  );

  // Abonnement Realtime aux évènements de la conversation.
  useEffect(() => {
    let resolveReady: () => void = () => {};
    readyRef.current = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const channel = supabase
      .channel(`chat-stream-${conversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "chat",
          table: "stream_events",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const row = payload.new as {
            kind: string;
            payload: StreamEventPayload;
          };
          handleStreamEvent(row.kind, row.payload ?? {});
        },
      )
      .subscribe((status_) => {
        if (status_ === "SUBSCRIBED") {
          resolveReady();
        } else if (status_ === "CHANNEL_ERROR" || status_ === "TIMED_OUT") {
          toast.error(
            "La connexion temps réel (Realtime) a échoué : la réponse peut ne pas s'afficher en direct.",
          );
          resolveReady();
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversation.id, handleStreamEvent, supabase]);

  const send = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || streamingRef.current) return;
      // Attend l'abonnement Realtime pour ne pas manquer le début du flux.
      await (readyRef.current ?? Promise.resolve());
      streamingRef.current = true;
      setStreaming(true);
      setStatus("Connexion au lakehouse…");
      setToolTrace([]);
      setStreamText("");
      setMessages((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          conversation_id: conversation.id,
          role: "user",
          content: trimmed,
          metadata: {},
          created_at: new Date().toISOString(),
        },
      ]);

      try {
        const res = await fetch(`/chat/${conversation.id}/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: trimmed }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(
            `L'envoi a échoué (HTTP ${res.status}) ${text.slice(0, 200)}`,
          );
        }
        // Filet de sécurité : si l'évènement « done » Realtime a été manqué,
        // la réponse HTTP porte le texte final.
        const result = (await res.json()) as {
          ok?: boolean;
          text?: string;
        };
        if (streamingRef.current) {
          finalize(result.text ?? "");
        }
      } catch (error) {
        if (streamingRef.current) {
          finalize(
            `La réponse a échoué : ${error instanceof Error ? error.message : "erreur inattendue"}`,
          );
        }
        toast.error(
          error instanceof Error
            ? error.message
            : "L'agent n'a pas pu répondre : erreur inattendue.",
        );
      }
    },
    [conversation.id, finalize],
  );

  // Premier message transmis depuis « Nouveau chat » via ?pending= (prop
  // lue côté serveur). Déclenchement au montage, hors du corps de l'effet.
  useEffect(() => {
    if (!pendingMessage) return;
    const frame = requestAnimationFrame(() => void send(pendingMessage));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRename() {
    try {
      await renameConversation(conversation.id, newTitle);
      toast.success("Conversation renommée.");
      setRenaming(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Le renommage a échoué.",
      );
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100svh-8rem)] max-w-4xl flex-col lg:h-[calc(100svh-4rem)]">
      {/* En-tête conversation */}
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-charbon text-jaune">
          <Bot className="h-5 w-5" strokeWidth={1.6} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl">
            {conversation.title ?? "Nouvelle conversation"}
          </h1>
          <p className="mono truncate text-xs text-muted-foreground">
            {conversation.agentName} · {conversation.model}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Actions de conversation">
              <Pencil className="h-4 w-4" strokeWidth={1.6} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                setNewTitle(conversation.title ?? "");
                setRenaming(true);
              }}
            >
              <Pencil className="h-4 w-4" /> Renommer
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() =>
                void deleteConversation(conversation.id).then((r) => {
                  if (r && !r.ok) {
                    toast.error(r.error ?? "La suppression a échoué.");
                  }
                })
              }
            >
              <Trash2 className="h-4 w-4" /> Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-4 overflow-y-auto py-6 pr-1">
        {messages.length === 0 && !streaming ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <ParusLogo />
            <p className="text-sm text-muted-foreground">
              Posez votre première question à {conversation.agentName}.
            </p>
          </div>
        ) : null}
        {messages.map((m) => (
          <MessageBubble key={m.id} role={m.role} content={m.content} />
        ))}

        {streaming ? (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg rounded-tl-none bg-charbon px-4 py-2.5 text-blanc">
              {toolTrace.length > 0 ? (
                <div className="mb-2 space-y-1">
                  {toolTrace.map((t, i) => (
                    <p key={i} className="mono flex items-center gap-1.5 text-[11px] text-blanc/60">
                      <Terminal className="h-3 w-3 text-olive" strokeWidth={1.8} />
                      {t.tool}
                      {t.query ? ` : ${t.query.replace(/\s+/g, " ").slice(0, 80)}` : ""}
                      {t.ok === false ? " — erreur" : ""}
                    </p>
                  ))}
                </div>
              ) : null}
              {status ? (
                <p className="mono text-xs text-jaune">{status}</p>
              ) : null}
              {streamText ? (
                <div className="text-sm whitespace-pre-wrap">{streamText}</div>
              ) : !status ? (
                <span className="mono text-xs text-blanc/60">…</span>
              ) : null}
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-border pt-4">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const value = input;
                setInput("");
                void send(value);
              }
            }}
            placeholder={`Message à ${conversation.agentName}…`}
            className="max-h-40 min-h-11"
            aria-label="Votre message"
            disabled={streaming}
          />
          <Button
            onClick={() => {
              const value = input;
              setInput("");
              void send(value);
            }}
            disabled={streaming || input.trim().length === 0}
            size="icon"
            className="h-11 w-11 shrink-0 bg-jaune text-charbon hover:bg-jaune/90"
            aria-label="Envoyer"
          >
            <Send className="h-4 w-4" strokeWidth={1.8} />
          </Button>
        </div>
        <p className="mono mt-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Réponses générées localement · Diffusion Supabase Realtime · SQL en lecture seule
        </p>
      </div>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renommer la conversation</DialogTitle>
          </DialogHeader>
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Nouveau titre"
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>
              Annuler
            </Button>
            <Button
              onClick={handleRename}
              disabled={newTitle.trim().length === 0}
              className="bg-jaune font-semibold text-charbon hover:bg-jaune/90"
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
