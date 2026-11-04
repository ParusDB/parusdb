// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { AdminUsersTabs } from "@/components/admin/users-tabs";
import type { AdminUserRow } from "@/components/admin/users-table";
import type { AppUserRow } from "@/components/admin/app-users-table";
import { requireAdmin } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppUser } from "@/types/db";

// Statut « désactivé » : bannissement GoTrue toujours actif. Le calcul de
// l'impureté (Date) vit hors du rendu du composant.
function isBanned(bannedUntil: string | undefined | null): boolean {
  return (
    bannedUntil !== undefined &&
    bannedUntil !== null &&
    new Date(bannedUntil).getTime() > Date.now()
  );
}

export default async function AdminUsersPage() {
  await requireAdmin();
  const admin = createAdminClient();

  const [
    { data: userList },
    { data: profiles },
    { data: roles },
    { data: userRoles },
    { data: appUserRows },
  ] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    admin.schema("iam").from("user_profiles").select("id, first_name, last_name, phone"),
    admin.schema("iam").from("roles").select("id, key, name").order("name"),
    admin.schema("iam").from("user_roles").select("user_id, role_id"),
    admin
      .schema("iam")
      .from("app_users")
      .select("id, name, note, role_id, polaris_client_id, credentials_rotated_at, created_at, created_by"),
  ]);

  const profileMap = new Map(
    (profiles ?? []).map((p: { id: string; first_name: string | null; last_name: string | null; phone: string | null }) => [
      p.id,
      p,
    ]),
  );
  const roleMap = new Map((roles ?? []).map((r: { id: string; key: string; name: string }) => [r.id, r]));
  const rolesByUser = new Map<string, string[]>();
  for (const ur of (userRoles ?? []) as { user_id: string; role_id: string }[]) {
    const list = rolesByUser.get(ur.user_id) ?? [];
    if (roleMap.has(ur.role_id)) list.push(ur.role_id);
    rolesByUser.set(ur.user_id, list);
  }

  const users = userList.users.map((u) => {
    const profile = profileMap.get(u.id);
    return {
      id: u.id,
      email: u.email ?? "",
      firstName: profile?.first_name ?? null,
      lastName: profile?.last_name ?? null,
      phone: profile?.phone ?? null,
      roleIds: rolesByUser.get(u.id) ?? [],
      disabled: isBanned(u.banned_until),
      createdAt: u.created_at ?? "",
    };
  });

  const roleOptions = (roles ?? []).map((r: { id: string; key: string; name: string }) => ({
    id: r.id,
    name: r.name,
    key: r.key,
  }));

  const appUsers: AppUserRow[] = (appUserRows ?? []).map((a) => {
    const row = a as unknown as AppUser;
    return {
      id: row.id,
      name: row.name,
      note: row.note,
      roleId: row.role_id,
      clientId: row.polaris_client_id,
      rotatedAt: row.credentials_rotated_at,
      createdAt: row.created_at,
    };
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Administration"
        title="Utilisateurs"
        description="Comptes humains (connexion à l'interface) et comptes applicatifs (outils data connectés au catalogue Iceberg). Les rôles applicatifs vivent dans PostgreSQL, jamais dans les JWT claims éditables."
      />
      <AdminUsersTabs users={users as AdminUserRow[]} appUsers={appUsers} roles={roleOptions} />
    </div>
  );
}
