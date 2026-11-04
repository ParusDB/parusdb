"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageSquare, Pencil, Search, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CharbonPanel } from "@/components/parus/charbon-panel";
import { deleteConversation, renameConversation } from "@/app/(app)/chat/actions";

export interface ConversationItem {
  id: string;
  title: string | null;
  updatedAt: string;
  agentName: string;
}

export function ConversationList({
  conversations,
}: {
  conversations: ConversationItem[];
  userName: string;
}) {
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState<ConversationItem | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const router = useRouter();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) =>
      (c.title ?? "conversation").toLowerCase().includes(q),
    );
  }, [conversations, search]);

  async function handleRename() {
    if (!renaming) return;
    try {
      await renameConversation(renaming.id, newTitle);
      toast.success("Conversation renommée.");
      setRenaming(null);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Le renommage a échoué.",
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher par nom de conversation…"
          className="pl-9"
          aria-label="Rechercher une conversation"
        />
      </div>

      {conversations.length === 0 ? (
        <CharbonPanel className="text-center">
          <h2 className="font-display text-2xl">
            Vos données, enfin parlantes.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-blanc/70">
            Aucune conversation pour l’instant. Démarrez un chat avec un agent
            IA : il explore le lakehouse, exécute le SQL et vous répond.
          </p>
          <Button
            asChild
            className="mt-6 rounded-full bg-jaune font-semibold text-charbon shadow-[0_20px_60px_-20px_rgba(255,215,0,0.5)] transition-transform hover:-translate-y-0.5"
          >
            <Link href="/chat/new">Démarrer une conversation</Link>
          </Button>
        </CharbonPanel>
      ) : filtered.length === 0 ? (
        <p className="rounded-3xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Aucune conversation ne correspond à « {search} ».
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((c) => (
            <li
              key={c.id}
              className="group flex items-center gap-3 rounded-3xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-charbon hover:shadow-[0_24px_60px_-30px_rgba(26,26,26,0.35)]"
            >
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-charbon text-jaune">
                <MessageSquare className="h-5 w-5" strokeWidth={1.6} />
              </span>
              <Link href={`/chat/${c.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {c.title ?? "Conversation sans titre"}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {c.agentName} · modifiée le {formatDate(c.updatedAt)}
                </p>
              </Link>
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Renommer la conversation"
                  onClick={() => {
                    setRenaming(c);
                    setNewTitle(c.title ?? "");
                  }}
                >
                  <Pencil className="h-4 w-4" strokeWidth={1.6} />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Supprimer la conversation"
                      className="hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.6} />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Supprimer cette conversation ?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        « {c.title ?? "Conversation sans titre"} » et son
                        historique seront supprimés définitivement.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-white hover:bg-destructive/90"
                        onClick={() => void deleteConversation(c.id).then((r) => {
                          if (r && !r.ok) {
                            toast.error(r.error ?? "La suppression a échoué.");
                          }
                        })}
                      >
                        Supprimer
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
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
            <Button variant="outline" onClick={() => setRenaming(null)}>
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
