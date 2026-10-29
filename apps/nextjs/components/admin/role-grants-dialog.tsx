"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Database, Bot, Plug } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Grant, Role } from "@/types/db";
import { setRoleGrant, type GrantPrivilege } from "@/app/(app)/admin/actions";
import { PRIVILEGES } from "@/lib/permissions";

// Éditeur des droits d'un rôle (RBAC refonte — docs/functional/rbac_refonte.md)
// : matrice ressources (catalogues / agents / pipelines) × privilèges
// (lecture / écriture / gestion). Les privilèges sont hiérarchiques :
// cocher un niveau supérieur inclut les inférieurs, décocher un niveau
// inférieur retire les supérieurs. L'admin hérite de tout : pas d'éditeur
// pour le rôle système « admin ».

export interface GrantResource {
  id: string;
  name: string;
}

const RESOURCE_TABS = [
  { key: "catalog", label: "Catalogues", icon: Database },
  { key: "agent", label: "Agents IA", icon: Bot },
  { key: "pipeline", label: "Pipelines", icon: Plug },
] as const;

type ResourceKey = (typeof RESOURCE_TABS)[number]["key"];

export function RoleGrantsDialog({
  role,
  open,
  onOpenChange,
  grants,
  catalogs,
  agents,
  pipelines,
}: {
  role: Role;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grants: Grant[];
  catalogs: GrantResource[];
  agents: GrantResource[];
  pipelines: GrantResource[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const roleGrants = grants.filter((g) => g.role_id === role.id);
  const resourcesByType: Record<ResourceKey, GrantResource[]> = {
    catalog: catalogs,
    agent: agents,
    pipeline: pipelines,
  };

  function privilegesOf(
    resourceType: ResourceKey,
    resourceId: string,
  ): Set<GrantPrivilege> {
    const row = roleGrants.find(
      (g) => g.resource_type === resourceType && g.resource_id === resourceId,
    );
    return new Set(row?.privileges ?? []);
  }

  async function toggle(
    resourceType: ResourceKey,
    resourceId: string,
    privilege: GrantPrivilege,
  ) {
    if (pending) return;
    const current = privilegesOf(resourceType, resourceId);
    const next = new Set(current);
    const rank = (p: string) =>
      p === "read" ? 1 : p === "write" ? 2 : p === "manage" ? 3 : 0;
    if (next.has(privilege)) {
      // Décocher un niveau retire aussi les niveaux supérieurs.
      for (const p of [...next]) {
        if (rank(p) >= rank(privilege)) next.delete(p);
      }
    } else {
      // Cocher un niveau inclut les niveaux inférieurs.
      for (const p of PRIVILEGES.map((priv) => priv.key)) {
        if (rank(p) <= rank(privilege)) next.add(p);
      }
    }
    setPending(true);
    try {
      const result = await setRoleGrant({
        roleId: role.id,
        resourceType,
        resourceId,
        privileges: [...next],
      });
      if (result.ok) {
        if (result.warning) toast.warning(result.warning);
        router.refresh();
      } else {
        toast.error(result.error ?? "L'enregistrement a échoué.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Droits du rôle « {role.name} »</DialogTitle>        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Les utilisateurs portant ce rôle (actif) voient et utilisent les
          objets selon les privilèges ci-dessous. La propriété confère
          automatiquement tous les droits sur un objet créé par le rôle.
        </p>
        <Tabs defaultValue="catalog">
          <TabsList>
            {RESOURCE_TABS.map(({ key, label, icon: Icon }) => (
              <TabsTrigger key={key} value={key}>
                <Icon className="h-4 w-4" strokeWidth={1.6} /> {label}
                <Badge variant="outline" className="mono ml-1 text-[10px] font-normal">
                  {roleGrants.filter((g) => g.resource_type === key).length}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
          {RESOURCE_TABS.map(({ key }) => {
            const rows = resourcesByType[key];
            return (
              <TabsContent key={key} value={key} className="space-y-3">
                {rows.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    Aucun objet de ce type pour l’instant.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Objet</TableHead>
                          {PRIVILEGES.map((p) => (
                            <TableHead key={p.key} className="text-center">
                              {p.label}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((r) => {
                          const privileges = privilegesOf(key, r.id);
                          return (
                            <TableRow key={r.id}>
                              <TableCell className="font-medium">
                                {r.name}
                              </TableCell>
                              {PRIVILEGES.map((p) => (
                                <TableCell key={p.key} className="text-center">
                                  <Checkbox
                                    aria-label={`${p.label} sur ${r.name}`}
                                    checked={privileges.has(p.key)}
                                    onCheckedChange={() =>
                                      void toggle(key, r.id, p.key)
                                    }
                                    disabled={pending}
                                    className="data-[state=checked]:border-jaune data-[state=checked]:bg-jaune data-[state=checked]:text-charbon"
                                  />
                                </TableCell>
                              ))}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
