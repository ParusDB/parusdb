"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Plus, Shield, Trash2 } from "lucide-react";
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
import { PERMISSIONS, permissionLabel } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Role } from "@/types/db";
import {
  createRole,
  deleteRole,
  updateRole,
} from "@/app/(app)/admin/actions";

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
  const [permissions, setPermissions] = useState<string[]>(
    role?.permissions ?? [],
  );
  const [pending, setPending] = useState(false);
  const router = useRouter();

  function togglePermission(pkey: string) {
    setPermissions((prev) =>
      prev.includes(pkey)
        ? prev.filter((p) => p !== pkey)
        : [...prev, pkey],
    );
  }

  async function handleSubmit() {
    if (pending) return;
    if (!name.trim() || (!isEdit && !key.trim())) {
      toast.error("Le nom (et l’identifiant) sont obligatoires.");
      return;
    }
    setPending(true);
    try {
      const result = isEdit
        ? await updateRole(role.id, { name, description, permissions })
        : await createRole({
            key: key.trim(),
            name: name.trim(),
            description,
            permissions,
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
                placeholder="Data Analyst"
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
                  placeholder="data_analyst"
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
              placeholder="Accès lecture au lakehouse et au chat"
            />
          </div>
          <div className="grid gap-2">
            <Label>Permissions</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {PERMISSIONS.map((permission) => {
                const selected = permissions.includes(permission.key);
                return (
                  <button
                    key={permission.key}
                    type="button"
                    onClick={() => togglePermission(permission.key)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      selected
                        ? "border-jaune bg-jaune/10"
                        : "border-border hover:border-charbon",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full border",
                        selected
                          ? "border-jaune bg-jaune text-charbon"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {selected ? (
                        <Check className="h-3 w-3" strokeWidth={2} />
                      ) : null}
                    </span>
                    {permission.label}
                  </button>
                );
              })}
            </div>
          </div>
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
              <TableHead>Permissions</TableHead>
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
                <TableCell>
                  <div className="flex max-w-md flex-wrap gap-1">
                    {role.permissions.map((p) => (
                      <Badge
                        key={p}
                        variant="outline"
                        className="mono text-[10px] font-normal"
                      >
                        {permissionLabel(p)}
                      </Badge>
                    ))}
                  </div>
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
                        description={`Le rôle « ${role.name} » sera supprimé. Les utilisateurs qui le portent doivent être réaffectés au préalable.`}
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
