import { createClient } from "@/lib/supabase/server";
import type { SessionContext, Privilege, ResourceType } from "@/lib/session";
import type { Grant } from "@/types/db";

// Helpers RBAC côté serveur (docs/functional/rbac_refonte.md) : calcul des
// listes d'objets accessibles au rôle actif et des capacités par objet.
// La RLS reste la garde finale — ces helpers servent à construire l'UI
// (listes filtrées, boutons affichés selon le privilège effectif).

// Grants du rôle actif (une requête, puis calculs en mémoire). Le compte
// admin hérite de tout sans ligne de grant.
export async function grantsForActiveRole(
  session: SessionContext,
): Promise<Grant[]> {
  if (!session.activeRole || session.isAdmin) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("iam")
    .from("grants")
    .select("role_id, resource_type, resource_id, privileges")
    .eq("role_id", session.activeRole.id);
  if (error) {
    throw new Error(`La lecture des droits du rôle a échoué : ${error.message}`);
  }
  return (data ?? []) as unknown as Grant[];
}

// Le rôle actif possède-t-il la ressource, ou un grant couvre-t-il le
// privilège ? (miroir applicatif de iam.has_grant, sans requête par objet)
export function can(
  session: SessionContext,
  grants: Grant[],
  resourceType: ResourceType,
  resourceId: string,
  ownerRoleId: string | null,
  privilege: Privilege,
): boolean {
  if (session.isAdmin) return true;
  const activeRoleId = session.activeRole?.id ?? null;
  if (!activeRoleId) return false;
  const owned = ownerRoleId !== null && ownerRoleId === activeRoleId;
  const rank: Record<Privilege, number> = { read: 1, write: 2, manage: 3 };
  const granted = grants.some(
    (g) =>
      g.resource_type === resourceType &&
      g.resource_id === resourceId &&
      g.privileges.some((p) => rank[p] >= rank[privilege]),
  );
  return owned || granted;
}

// Catalogues lisibles par le rôle actif : le registre est filtré par RLS
// (catalog_registry_select_perm = has_grant read).
export async function readableCatalogNames(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("lakehouse")
    .from("catalog_registry")
    .select("catalog_name")
    .order("catalog_name");
  if (error) {
    throw new Error(
      `La lecture des catalogues accessibles a échoué : ${error.message}`,
    );
  }
  return (data ?? []).map((r: { catalog_name: string }) => r.catalog_name);
}

// Catalogues utilisables comme destination d'ingestion (privilège write :
// propriété du rôle actif ou grant). Le registre n'expose que les
// catalogues lisibles ; un catalogue accessible en écriture l'est aussi en
// lecture (hiérarchie des privilèges).
export async function writableCatalogNames(
  session: SessionContext,
): Promise<string[]> {
  const supabase = await createClient();
  const [registryRes, grants] = await Promise.all([
    supabase
      .schema("lakehouse")
      .from("catalog_registry")
      .select("catalog_name, owner_role_id")
      .order("catalog_name"),
    grantsForActiveRole(session),
  ]);
  if (registryRes.error) {
    throw new Error(
      `La lecture des catalogues accessibles a échoué : ${registryRes.error.message}`,
    );
  }
  const rows = (registryRes.data ?? []) as {
    catalog_name: string;
    owner_role_id: string | null;
  }[];
  return rows
    .filter((r) =>
      can(session, grants, "catalog", r.catalog_name, r.owner_role_id, "write"),
    )
    .map((r) => r.catalog_name);
}
