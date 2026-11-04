"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
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
import { ConfirmNameDialog } from "@/components/parus/confirm-name-dialog";

// Ligne de liste de la sidebar (conversation, agent) : le lien est passé en
// enfant, le bouton « trois points » n'apparaît qu'au survol et ouvre le menu
// Renommer / Supprimer. La suppression d'un agent suit le pattern destructif
// obligatoire (ressaisie du nom), celle d'une conversation une confirmation
// simple - mêmes patterns que les pages Chat et Agents.
export function SidebarListItem({
  children,
  label,
  href,
  onRename,
  onDelete,
  deleteRequiresName = false,
  deleteTitle,
  deleteDescription,
}: {
  children: React.ReactNode;
  label: string;
  href: string;
  onRename?: (label: string) => Promise<void>;
  onDelete?: () => Promise<{ ok: boolean; error?: string }>;
  deleteRequiresName?: boolean;
  deleteTitle: string;
  deleteDescription: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [renaming, setRenaming] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const parentHref = href.slice(0, href.lastIndexOf("/"));

  // Supprimer l'élément ouvert revient à sa liste d'origine.
  async function runDelete(): Promise<{ ok: boolean; error?: string }> {
    if (!onDelete) return { ok: false, error: "Suppression non autorisée." };
    const result = await onDelete();
    if (result.ok && (pathname === href || pathname.startsWith(`${href}/`))) {
      router.push(parentHref);
    }
    return result;
  }

  async function handleRename() {
    if (!onRename) return;
    setPending(true);
    try {
      await onRename(newLabel);
      toast.success("Renommage effectué.");
      setRenaming(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Le renommage a échoué.",
      );
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setPending(true);
    try {
      const result = await runDelete();
      if (result.ok) {
        toast.success(`« ${label} » a été supprimé.`);
        setConfirming(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "La suppression a échoué.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="group relative flex items-center">
      <div className="min-w-0 flex-1">{children}</div>
      {onRename || onDelete ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-blanc/50 opacity-0 transition-opacity hover:bg-white/5 hover:text-jaune focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            aria-label={`Options pour ${label}`}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="h-4 w-4" strokeWidth={1.8} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right">
          {onRename ? (
            <DropdownMenuItem
              onSelect={() => {
                setNewLabel(label);
                setRenaming(true);
              }}
            >
              <Pencil className="h-4 w-4" strokeWidth={1.6} /> Renommer
            </DropdownMenuItem>
          ) : null}
          {onDelete ? (
            <DropdownMenuItem
              onSelect={() => setConfirming(true)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.6} /> Supprimer
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      ) : null}

      {renaming ? (
        <Dialog open={renaming} onOpenChange={setRenaming}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Renommer</DialogTitle>
            </DialogHeader>
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Nouveau nom"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && void handleRename()}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenaming(false)}>
                Annuler
              </Button>
              <Button
                onClick={() => void handleRename()}
                disabled={newLabel.trim().length === 0 || pending}
                className="bg-jaune font-semibold text-charbon hover:bg-jaune/90"
              >
                Enregistrer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {deleteRequiresName ? (
        <ConfirmNameDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={deleteTitle}
          description={deleteDescription}
          expectedName={label}
          action={runDelete}
        />
      ) : (
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{deleteTitle}</AlertDialogTitle>
              <AlertDialogDescription>{deleteDescription}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => void handleDelete()}
              >
                Supprimer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
