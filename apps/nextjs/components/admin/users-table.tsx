"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, UserRound } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { formatDateOnly } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  createUser,
  deleteUser,
  setUserStatus,
  updateUser,
} from "@/app/(app)/admin/actions";

export interface AdminUserRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  roleIds: string[];
  disabled: boolean;
  createdAt: string;
}

interface RoleOption {
  id: string;
  name: string;
}

function RoleChips({
  roleIds,
  roles,
}: {
  roleIds: string[];
  roles: RoleOption[];
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {roleIds.length === 0 ? (
        <span className="text-xs text-muted-foreground">Aucun rôle</span>
      ) : (
        roleIds.map((id) => {
          const role = roles.find((r) => r.id === id);
          return (
            <Badge key={id} variant="outline" className="mono text-[10px]">
              {role?.name ?? id.slice(0, 8)}
            </Badge>
          );
        })
      )}
    </div>
  );
}

function UserDialog({
  open,
  onOpenChange,
  roles,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: RoleOption[];
  user: AdminUserRow | null;
}) {
  const isEdit = user !== null;
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [roleIds, setRoleIds] = useState<string[]>(user?.roleIds ?? []);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  function toggleRole(id: string) {
    setRoleIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id],
    );
  }

  async function handleSubmit() {
    if (pending) return;
    if (!isEdit && (!email.trim() || password.length < 8)) {
      toast.error("Email et mot de passe (8 caractères minimum) sont obligatoires.");
      return;
    }
    if (roleIds.length === 0) {
      toast.error("Attribuez au moins un rôle.");
      return;
    }
    setPending(true);
    try {
      const result = isEdit
        ? await updateUser(user.id, { firstName, lastName, phone, roleIds })
        : await createUser({ email, password, firstName, lastName, phone, roleIds });
      if (result.ok) {
        toast.success(isEdit ? "Utilisateur mis à jour." : "Utilisateur créé.");
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
            {isEdit ? `Modifier ${user.email}` : "Ajouter un utilisateur"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!isEdit ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="user-email">Email</Label>
                <Input
                  id="user-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="prenom.nom@entreprise.fr"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="user-password">Mot de passe provisoire</Label>
                <Input
                  id="user-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="8 caractères minimum"
                />
              </div>
            </>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="user-first">Prénom</Label>
              <Input id="user-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user-last">Nom</Label>
              <Input id="user-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="user-phone">Téléphone</Label>
            <Input id="user-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Rôles</Label>
            <div className="flex flex-wrap gap-2">
              {roles.map((role) => {
                const selected = roleIds.includes(role.id);
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => toggleRole(role.id)}
                    className={cn(
                      "mono rounded-full border px-3 py-1.5 text-xs transition-colors",
                      selected
                        ? "border-jaune bg-jaune text-charbon"
                        : "border-border bg-card text-muted-foreground hover:border-charbon hover:text-foreground",
                    )}
                  >
                    {role.name}
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
            {pending ? "Enregistrement…" : isEdit ? "Enregistrer" : "Créer l’utilisateur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UsersTable({
  users,
  roles,
}: {
  users: AdminUserRow[];
  roles: RoleOption[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const router = useRouter();

  async function handleToggle(user: AdminUserRow, next: boolean) {
    const result = await setUserStatus(user.id, next);
    if (result.ok) {
      toast.success(next ? "Utilisateur désactivé." : "Utilisateur réactivé.");
      router.refresh();
    } else {
      toast.error(result.error ?? "Le changement de statut a échoué.");
    }
  }

  async function handleDelete(user: AdminUserRow) {
    const result = await deleteUser(user.id);
    if (result.ok) {
      toast.success("Utilisateur supprimé.");
      router.refresh();
    } else {
      toast.error(result.error ?? "La suppression a échoué.");
    }
  }

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
          <Plus strokeWidth={1.8} /> Ajouter un utilisateur
        </Button>
      </div>
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        <Table className="[&_th]:px-4 [&_td]:px-4">
          <TableHeader>
            <TableRow>
              <TableHead>Utilisateur</TableHead>
              <TableHead>Téléphone</TableHead>
              <TableHead>Rôles</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Créé le</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-charbon text-jaune">
                      <UserRound className="h-4 w-4" strokeWidth={1.6} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {[user.firstName, user.lastName].filter(Boolean).join(" ") ||
                          "-"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {user.phone ?? "-"}
                </TableCell>
                <TableCell>
                  <RoleChips roleIds={user.roleIds} roles={roles} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={!user.disabled}
                      onCheckedChange={(checked) => void handleToggle(user, !checked)}
                      aria-label={`Activer ou désactiver ${user.email}`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {user.disabled ? "Désactivé" : "Actif"}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateOnly(user.createdAt)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Modifier ${user.email}`}
                      onClick={() => {
                        setEditing(user);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" strokeWidth={1.6} />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="hover:text-destructive"
                          aria-label={`Supprimer ${user.email}`}
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.6} />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Supprimer cet utilisateur ?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Le compte {user.email} et toutes ses données
                            applicatives (conversations, agents, pipelines)
                            seront supprimés définitivement.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annuler</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-white hover:bg-destructive/90"
                            onClick={() => void handleDelete(user)}
                          >
                            Supprimer
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {dialogOpen ? (
        <UserDialog
          key={editing?.id ?? "new"}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          roles={roles}
          user={editing}
        />
      ) : null}
    </div>
  );
}
