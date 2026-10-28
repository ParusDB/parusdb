"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Shield, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmNameDialog } from "@/components/parus/confirm-name-dialog";
import type { Role } from "@/types/db";
import {
  createRole,
  deleteRole,
  updateRole,
} from "@/app/(app)/admin/actions";

// Table des rôles (RBAC refonte — docs/functional/rbac_refonte.md). La
// distribution des droits par rôle (grants lecture/écriture/gestion sur les
// catalogues, agents et pipelines) se fait dans l'éditeur dédié de chaque
// rôle ; ici : création/édition des rôles, effectifs, suppression.

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function RoleDialog({
  open,
  onOpenChange,
  role,
  counts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: Role | null;
  counts: Record<string, number>;
}) {
  const isEdit = role !== null;
  const [name, setName] = useState(role?.name ?? "");
  const [key, setKey] = useState(role?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(isEdit);
  const [description, setDescription] = useState(role?.description ?? "");
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleSubmit() {
    if (pending) return;
    if (!name.trim() || (!isEdit && !key.trim())) {
      toast.error("Le nom (et l’identifiant) sont obligatoires.");
      return;
    }
    setPending(true);
    try {
      const result = isEdit
        ? await updateRole(role.id, { name, description })
        : await createRole({
            key: key.trim(),
            name: name.trim(),
            description,
          });
      if (result.ok) {
        toast.success(isEdit ? "Rôle mis à jour." : "Rôle créé.");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "L’enregistrement a échoué.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Modifier le rôle ${role.name}` : "Nouveau rôle"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="role-name">Nom</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!keyTouched) setKey(slugify(e.target.value));
                }}
                placeholder="Data Engineer"
              />
            </div>
            {!isEdit ? (
              <div className="grid gap-2">
                <Label htmlFor="role-key">Identifiant (snake_case)</Label>
                <Input
                  id="role-key"
                  value={key}
                  onChange={(e) => {
                    setKeyTouched(true);
                    setKey(slugify(e.target.value));
                  }}
                  placeholder="data_engineer"
                  className="mono"
                />
              </div>
            ) : (
              <div className="grid items-end gap-2">
                <Label>Utilisateurs</Label>
                <p className="mono text-sm text-muted-foreground">
                  {counts[role.id] ?? 0} utilisateur(s)
                </p>
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="role-description">Description</Label>
            <Input
              id="role-description"
              value={description ?? ""}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Accès lecture au catalogue sales, écriture sur les agents de l'équipe"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Les droits sur les objets (catalogues, agents IA, pipelines) se
            distribuent depuis la fiche du rôle une fois celui-ci créé.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={pending}
            className="bg-jaune font-semibold text-charbon hover:bg-jaune/90"
          >
            {pending ? "Enregistrement…" : isEdit ? "Enregistrer" : "Créer le rôle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RolesTable({
  roles,
  counts,
}: {
  roles: Role[];
  counts: Record<string, number>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
          className="rounded-full bg-jaune font-semibold text-charbon hover:bg-jaune/90"
        >
          <Plus strokeWidth={1.8} /> Nouveau rôle
        </Button>
      </div>
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rôle</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Utilisateurs</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role) => (
              <TableRow key={role.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-olive" strokeWidth={1.6} />
                    <div>
                      <p className="font-medium">
                        {role.name}
                        {role.is_system ? (
                          <Badge className="mono ml-2 bg-bleu text-[10px] text-white">
                            système
                          </Badge>
                        ) : null}
                      </p>
                      <p className="mono text-xs text-muted-foreground">
                        {role.key}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="max-w-md text-muted-foreground">
                  {role.description ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {counts[role.id] ?? 0}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Modifier le rôle ${role.name}`}
                      onClick={() => {
                        setEditing(role);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" strokeWidth={1.6} />
                    </Button>
                    {!role.is_system ? (
                      <ConfirmNameDialog
                        title="Supprimer ce rôle ?"
                        description={`Le rôle « ${role.name} » sera supprimé. Les utilisateurs qui le portent et les objets qu'il possède doivent être réaffectés au préalable.`}
                        expectedName={role.name}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="hover:text-destructive"
                            aria-label={`Supprimer le rôle ${role.name}`}
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.6} />
                          </Button>
                        }
                        action={() => deleteRole(role.id)}
                      />
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {dialogOpen ? (
        <RoleDialog
          key={editing?.id ?? "new"}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          role={editing}
          counts={counts}
        />
      ) : null}
    </div>
  );
}
