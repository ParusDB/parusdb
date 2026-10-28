// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { RolesTable } from "@/components/admin/roles-table";
import { requireAdmin } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { listCatalogs } from "@/lib/polaris";
import type { Grant, Role } from "@/types/db";

export default async function AdminRolesPage() {
  await requireAdmin();
  const admin = createAdminClient();

  const [
    { data: roles },
    { data: userRoles },
    { data: grants },
    { data: agents },
    { data: pipelines },
  ] = await Promise.all([
    admin.schema("iam").from("roles").select("*").order("created_at"),
    admin.schema("iam").from("user_roles").select("role_id"),
    admin
      .schema("iam")
      .from("grants")
      .select("role_id, resource_type, resource_id, privileges"),
    admin.schema("agents").from("agents").select("id, name").order("name"),
    admin
      .schema("connectors")
      .from("pipelines")
      .select("id, name")
      .order("created_at", { ascending: false }),
  ]);

  // Catalogues : Polaris reste la source de vérité (AGENTS.md §10) ; en cas
  // d'indisponibilité, l'éditeur reste utilisable avec les grants existants.
  let catalogs: { id: string; name: string }[] = [];
  let polarisError: string | null = null;
  try {
    catalogs = (await listCatalogs()).map((c) => ({ id: c.name, name: c.name }));
  } catch (error) {
    polarisError =
      error instanceof Error
        ? error.message
        : "Polaris est injoignable : la liste des catalogues est indisponible.";
  }

  const counts = new Map<string, number>();
  for (const ur of (userRoles ?? []) as { role_id: string }[]) {
    counts.set(ur.role_id, (counts.get(ur.role_id) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Administration"
        title="Rôles"
        description="Rôles applicatifs et droits par objet. Un utilisateur peut cumuler plusieurs rôles et choisir son rôle actif sans se déconnecter."
      />
      {polarisError ? (
        <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {polarisError}
        </p>
      ) : null}
      <RolesTable
        roles={(roles ?? []) as unknown as Role[]}
        counts={Object.fromEntries(counts) as Record<string, number>}
        grants={(grants ?? []) as unknown as Grant[]}
        catalogs={catalogs}
        agents={(agents ?? []).map((a: { id: string; name: string }) => ({
          id: a.id,
          name: a.name,
        }))}
        pipelines={(pipelines ?? []).map((p: { id: string; name: string }) => ({
          id: p.id,
          name: p.name,
        }))}
      />
    </div>
  );
}
