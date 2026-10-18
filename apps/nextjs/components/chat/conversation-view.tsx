"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Pencil, Send, Terminal, Trash2 } from "lucide-react";
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

interface StreamEvent {
  type: "status" | "tool" | "tool_result" | "token" | "error" | "done";
  label?: string;
  tool?: string;
  query?: string;
  ok?: boolean;
  text?: string;
  message?: string;
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
}

export function ConversationView({
  conversation,
  initialMessages,
}: ConversationViewProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [toolTrace, setToolTrace] = useState<{ tool: string; query?: string; ok?: boolean }[]>([]);
  const [streamText, setStreamText] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(conversation.title ?? "");
  const bottomRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, streamText, scrollToBottom]);

  const send = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || streaming) return;
      setStreaming(true);
      setStatus("Connexion au lakehouse…");
      setToolTrace([]);
      setStreamText("");
      setMessages((prev) => [
        ...prev,
        {
          id: `local-user-${Date.now()}`,
          conversation_id: conversation.id,
          role: "user",
          content: trimmed,
          metadata: {},
          created_at: new Date().toISOString(),
        },
      ]);

      try {
        const res = await fetch(
          `/chat/${conversation.id}/stream`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: trimmed }),
          },
        );
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          throw new Error(
            `L’envoi a échoué (HTTP ${res.status}) ${text.slice(0, 200)}`,
          );
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const lines = frame.split("\n");
            let eventName = "";
            let data = "";
            for (const line of lines) {
              if (line.startsWith("event: ")) eventName = line.slice(7).trim();
              else if (line.startsWith("data: ")) data += line.slice(6);
            }
            if (!data) continue;
            currentEvent = eventName;
            let event: StreamEvent;
            try {
              event = JSON.parse(data) as StreamEvent;
            } catch {
              continue;
            }
            if (event.type === "status") setStatus(event.label ?? null);
            else if (event.type === "tool") {
              setToolTrace((prev) => [
                ...prev,
                { tool: event.tool ?? "", query: event.query },
              ]);
              setStatus(`Outil ${event.tool}…`);
            } else if (event.type === "tool_result") {
              setToolTrace((prev) =>
                prev.map((t, i) =>
                  i === prev.length - 1
                    ? { ...t, ok: event.ok ?? true }
                    : t,
                ),
              );
            } else if (event.type === "token") {
              setStatus(null);
              setStreamText((prev) => prev + (event.text ?? ""));
            } else if (event.type === "error") {
              toast.error(event.message ?? "L’agent n’a pas pu répondre.");
            } else if (event.type === "done") {
              setMessages((prev) => [
                ...prev,
                {
                  id: `local-assistant-${Date.now()}`,
                  conversation_id: conversation.id,
                  role: "assistant",
                  content: event.text ?? "",
                  metadata: {},
                  created_at: new Date().toISOString(),
                },
              ]);
              setStreamText("");
              setStatus(null);
              router.refresh();
            }
          }
        }
        void currentEvent;
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "L’agent n’a pas pu répondre : erreur inattendue.",
        );
      } finally {
        setStreaming(false);
        setStatus(null);
      }
    },
    [conversation.id, router, streaming],
  );

  // Premier message transmis depuis « Nouveau chat » (agent déjà scellé).
  useEffect(() => {
    const key = `parus:pending-message:${conversation.id}`;
    const pending = sessionStorage.getItem(key);
    if (!pending) return;
    sessionStorage.removeItem(key);
    // Déclenchement hors du corps de l'effet (pas de setState synchrone).
    const frame = requestAnimationFrame(() => void send(pending));
    return () => cancelAnimationFrame(frame);
  }, [conversation.id, send]);

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
          Réponses générées localement · SQL exécuté en lecture seule
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
