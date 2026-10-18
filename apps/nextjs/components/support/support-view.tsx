"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpen, LifeBuoy, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { closeTicket, createTicket } from "@/app/(app)/admin/actions";
import type { Ticket } from "@/types/db";

export function SupportView({
  docUrl,
  tickets,
  ownerNames,
  isAdmin,
}: {
  docUrl: string;
  tickets: Ticket[];
  ownerNames: Record<string, string>;
  isAdmin: boolean;
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleSubmit() {
    if (pending) return;
    setPending(true);
    try {
      const result = await createTicket({ subject, message });
      if (result.ok) {
        toast.success("Ticket créé : notre équipe vous répond dès que possible.");
        setSubject("");
        setMessage("");
        router.refresh();
      } else {
        toast.error(result.error ?? "La création du ticket a échoué.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Documentation + contact */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-3xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:border-charbon hover:shadow-[0_24px_60px_-30px_rgba(26,26,26,0.35)]">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-jaune text-charbon">
            <BookOpen className="h-6 w-6" strokeWidth={1.6} />
          </div>
          <h3 className="font-display text-xl">Documentation</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Guides de démarrage, référence des connecteurs et principes
            d’architecture de la plateforme.
          </p>
          <Button asChild variant="outline" className="mt-4 rounded-full">
            <a href={docUrl} target="_blank" rel="noreferrer">
              Consulter la documentation
            </a>
          </Button>
        </div>

        <div className="rounded-3xl border border-border bg-card p-6">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-olive text-blanc">
            <LifeBuoy className="h-6 w-6" strokeWidth={1.6} />
          </div>
          <h3 className="font-display text-xl">Contacter le support</h3>
          <div className="mt-4 space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="ticket-subject">Objet</Label>
              <Input
                id="ticket-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Erreur lors de la création d’un catalogue"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ticket-message">Message</Label>
              <Textarea
                id="ticket-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Décrivez le problème rencontré, avec les étapes pour le reproduire."
                className="min-h-24"
              />
            </div>
            <Button
              onClick={() => void handleSubmit()}
              disabled={pending || !subject.trim() || !message.trim()}
              className="w-full rounded-full bg-jaune font-semibold text-charbon hover:bg-jaune/90"
            >
              <Send className="h-4 w-4" strokeWidth={1.8} />
              {pending ? "Envoi…" : "Ouvrir un ticket"}
            </Button>
          </div>
        </div>
      </div>

      {/* Tickets */}
      <div>
        <h3 className="mb-3 font-display text-lg">
          Tickets {isAdmin ? "(tous les utilisateurs)" : "(vos demandes)"}
        </h3>
        {tickets.length === 0 ? (
          <p className="rounded-3xl border border-border bg-card p-6 text-sm text-muted-foreground">
            Aucun ticket pour l’instant.
          </p>
        ) : (
          <ul className="space-y-2">
            {tickets.map((ticket) => (
              <li
                key={ticket.id}
                className="rounded-3xl border border-border bg-card p-5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{ticket.subject}</p>
                  <Badge
                    variant="outline"
                    className={
                      ticket.status === "open"
                        ? "mono border-jaune bg-jaune/10 text-[10px] text-charbon"
                        : "mono text-[10px]"
                    }
                  >
                    {ticket.status === "open" ? "ouvert" : "clos"}
                  </Badge>
                  {isAdmin && ownerNames[ticket.owner_id] ? (
                    <span className="mono text-xs text-muted-foreground">
                      {ownerNames[ticket.owner_id]}
                    </span>
                  ) : null}
                  <span className="mono ml-auto text-xs text-muted-foreground">
                    {formatDate(ticket.created_at)}
                  </span>
                </div>
                <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">
                  {ticket.message}
                </p>
                {isAdmin && ticket.status === "open" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={async () => {
                      const result = await closeTicket(ticket.id);
                      if (result.ok) {
                        toast.success("Ticket clôturé.");
                        router.refresh();
                      } else {
                        toast.error(result.error ?? "La clôture a échoué.");
                      }
                    }}
                  >
                    Clôturer le ticket
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
