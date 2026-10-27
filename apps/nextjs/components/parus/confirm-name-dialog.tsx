"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TriangleAlert } from "lucide-react";

// Confirmation destructif obligatoire : ressaisie du nom (AGENTS.md §10,
// spec §Notes — suppressions cascade irréversibles).
export function ConfirmNameDialog({
  trigger,
  title,
  description,
  expectedName,
  confirmLabel,
  action,
  open: openProp,
  onOpenChange,
}: {
  trigger?: React.ReactNode;
  title: string;
  description: string;
  expectedName: string;
  confirmLabel?: string;
  action: () => Promise<{ ok: boolean; error?: string }>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleConfirm() {
    setPending(true);
    try {
      const result = await action();
      if (result.ok) {
        toast.success(`${expectedName} a été supprimé.`);
        setOpen(false);
        setName("");
        router.refresh();
      } else {
        toast.error(result.error ?? "La suppression a échoué.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "La suppression a échoué : erreur inattendue.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <TriangleAlert className="h-5 w-5 text-destructive" strokeWidth={1.8} />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {description}{" "}
            <b>
              Cette action est irréversible : toutes les données associées
              seront perdues.
            </b>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Ressaisissez <b className="text-foreground">{expectedName}</b> pour
            confirmer :
          </p>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={expectedName}
            aria-label="Confirmation par ressaisie du nom"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={name !== expectedName || pending}
            onClick={handleConfirm}
          >
            {pending ? "Suppression…" : (confirmLabel ?? "Supprimer définitivement")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
