// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { RolesTable } from "@/components/admin/roles-table";
import { requireAdmin } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Role } from "@/types/db";

export default async function AdminRolesPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const [{ data: roles }, { data: userRoles }] = await Promise.all([
    admin.schema("iam").from("roles").select("*").order("created_at"),
    admin.schema("iam").from("user_roles").select("role_id"),
  ]);
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
      <RolesTable
        roles={(roles ?? []) as unknown as Role[]}
        counts={Object.fromEntries(counts) as Record<string, number>}
      />
    </div>
  );
}
