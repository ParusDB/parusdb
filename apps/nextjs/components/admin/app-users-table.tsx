"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, KeyRound, Plug, Plus, Trash2 } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmNameDialog } from "@/components/parus/confirm-name-dialog";
import { CharbonPanel } from "@/components/parus/charbon-panel";
import { formatDateOnly } from "@/lib/format";
import {
  createAppUser,
  deleteAppUser,
  rotateAppUserCredentials,
  updateAppUserRole,
} from "@/app/(app)/admin/actions";

// Utilisateurs applicatifs (comptes service pour les outils data —
// rbac_refonte.md §2.2) : miroir applicatif d'un principal Polaris. Le
// clientSecret n'est JAMAIS stocké ni réaffiché : il apparaît une seule
// fois, à la création ou à la réinitialisation.

export interface AppUserRow {
  id: string;
  name: string;
  note: string | null;
  roleId: string;
  clientId: string;
  rotatedAt: string | null;
  createdAt: string;
}

interface RoleOption {
  id: string;
  name: string;
  key: string;
}

// Modale credentials (affichage unique) : copie clientId + secret.
function CredentialsDialog({
  credentials,
  onOpenChange,
}: {
  credentials: { clientId: string; clientSecret: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  if (!credentials) return null;
  return (
    <Dialog open={credentials !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Credentials du compte applicatif</DialogTitle>
          <DialogDescription>
            Le secret n&apos;est affiché qu&apos;une seule fois : copiez-le
            maintenant. Une réinitialisation sera nécessaire si vous le
            perdez.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label>Client ID</Label>
            <div className="flex items-center gap-2">
              <code className="mono min-w-0 flex-1 truncate rounded-lg border border-border bg-card px-3 py-2 text-sm">
                {credentials.clientId}
              </code>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Copier le client ID"
                onClick={() => {
                  void navigator.clipboard.writeText(credentials.clientId);
                  toast.success("Client ID copié.");
                }}
              >
                <Copy className="h-4 w-4" strokeWidth={1.6} />
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Client secret</Label>
            <div className="flex items-center gap-2">
              <code className="mono min-w-0 flex-1 truncate rounded-lg border border-jaune/50 bg-jaune/10 px-3 py-2 text-sm text-charbon">
                {credentials.clientSecret}
              </code>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Copier le client secret"
                onClick={() => {
                  void navigator.clipboard.writeText(credentials.clientSecret);
                  toast.success("Client secret copié.");
                }}
              >
                <Copy className="h-4 w-4" strokeWidth={1.6} />
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AppUsersTable({
  appUsers,
  roles,
}: {
  appUsers: AppUserRow[];
  roles: RoleOption[];
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [roleId, setRoleId] = useState("");
  const [pending, setPending] = useState(false);
  const [credentials, setCredentials] = useState<{
    clientId: string;
    clientSecret: string;
  } | null>(null);


  async function handleCreate() {
    if (pending) return;
    if (!name.trim() || !roleId) {
      toast.error("Le nom et le rôle sont obligatoires.");
      return;
    }
    setPending(true);
    try {
      const result = await createAppUser({ name, note, roleId });
      if (result.ok) {
        toast.success(`Compte applicatif « ${name.trim().toLowerCase()} » créé.`);
        setCreateOpen(false);
        setName("");
        setNote("");
        setRoleId("");
        if (result.credentials) {
          setCredentials(result.credentials);
        }
        router.refresh();
      } else {
        toast.error(result.error ?? "La création a échoué.");
      }
    } finally {
      setPending(false);
    }
  }

  async function handleRotate(id: string) {
    const result = await rotateAppUserCredentials(id);
    if (result.ok) {
      toast.success("Credentials réinitialisées : copiez le nouveau secret.");
      if (result.credentials) setCredentials(result.credentials);
      router.refresh();
    } else {
      toast.error(result.error ?? "La réinitialisation a échoué.");
    }
  }

  async function handleRoleChange(id: string, nextRoleId: string) {
    const result = await updateAppUserRole(id, nextRoleId);
    if (result.ok) {
      toast.success("Rôle mis à jour : les accès Polaris sont resynchronisés.");
      router.refresh();
    } else {
      toast.error(result.error ?? "La mise à jour a échoué.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => setCreateOpen(true)}
          className="rounded-full bg-jaune font-semibold text-charbon hover:bg-jaune/90"
        >
          <Plus strokeWidth={1.8} /> Créer un utilisateur applicatif
        </Button>
      </div>

      {appUsers.length === 0 ? (
        <CharbonPanel className="text-center">
          <h2 className="font-display text-2xl">Aucun utilisateur applicatif</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-blanc/70">
            Créez un compte service pour connecter un outil data (dbt, Power BI,
            Airbyte, Spark…) au catalogue Iceberg : ses droits sont ceux du rôle
            choisi, distribués depuis /admin/roles.
          </p>
        </CharbonPanel>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Client ID</TableHead>
                <TableHead>Créé le</TableHead>
                <TableHead>Dernière rotation</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {appUsers.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Plug className="h-4 w-4 text-olive" strokeWidth={1.6} />
                      <div>
                        <p className="font-medium">{u.name}</p>
                        {u.note ? (
                          <p className="text-xs text-muted-foreground">{u.note}</p>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={u.roleId}
                      onValueChange={(value) => void handleRoleChange(u.id, value)}
                    >
                      <SelectTrigger
                        className="h-8 w-40 text-xs"
                        aria-label={`Rôle de ${u.name}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roles
                          .filter((r) => r.key !== "admin")
                          .map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="mono text-xs">
                    {u.clientId}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateOnly(u.createdAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {u.rotatedAt ? formatDateOnly(u.rotatedAt) : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Réinitialiser les credentials de ${u.name}`}
                        onClick={() => void handleRotate(u.id)}
                      >
                        <KeyRound className="h-4 w-4" strokeWidth={1.6} />
                      </Button>
                      <ConfirmNameDialog
                        title="Supprimer cet utilisateur applicatif ?"
                        description={`Le compte applicatif « ${u.name} » et ses credentials Polaris seront supprimés : l'outil qui les utilise perdra l'accès au lakehouse.`}
                        expectedName={u.name}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="hover:text-destructive"
                            aria-label={`Supprimer ${u.name}`}
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.6} />
                          </Button>
                        }
                        action={() => deleteAppUser(u.id)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nouvel utilisateur applicatif</DialogTitle>
            <DialogDescription>
              Compte service pour un outil data (dbt, Power BI, Airbyte…) : il
              accède au catalogue Iceberg Polaris avec les droits du rôle
              choisi — jamais avec les credentials du compte root.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="app-user-name">Nom</Label>
              <Input
                id="app-user-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="airbyte-prod"
                className="mono"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="app-user-note">Note d&apos;usage</Label>
              <Input
                id="app-user-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ingestion Airbyte de la source CRM"
              />
            </div>
            <div className="grid gap-2">
              <Label>Rôle (droits sur les catalogues)</Label>
              <Select value={roleId} onValueChange={setRoleId}>
                <SelectTrigger aria-label="Rôle du compte applicatif">
                  <SelectValue placeholder="Choisir un rôle" />
                </SelectTrigger>
                <SelectContent>
                  {roles
                    .filter((r) => r.key !== "admin")
                    .map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                        {r.key === "public" ? " (aucun accès)" : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Les droits de catalogue distribués au rôle via /admin/roles
                sont répliqués en grants Polaris réels.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={() => void handleCreate()}
              disabled={pending}
              className="bg-jaune font-semibold text-charbon hover:bg-jaune/90"
            >
              {pending ? "Création…" : "Créer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CredentialsDialog
        credentials={credentials}
        onOpenChange={(open) => {
          if (!open) setCredentials(null);
        }}
      />
    </div>
  );
}
