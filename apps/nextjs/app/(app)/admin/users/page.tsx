// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { UsersTable } from "@/components/admin/users-table";
import { requireAdmin } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

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

  const [{ data: userList }, { data: profiles }, { data: roles }, { data: userRoles }] =
    await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
      admin.schema("iam").from("user_profiles").select("id, first_name, last_name, phone"),
      admin.schema("iam").from("roles").select("id, key, name").order("name"),
      admin.schema("iam").from("user_roles").select("user_id, role_id"),
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

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Administration"
        title="Utilisateurs"
        description="Comptes, rôles attribués et statut d’accès. Les rôles applicatifs vivent dans PostgreSQL, jamais dans les JWT claims éditables."
      />
      <UsersTable
        users={users}
        roles={(roles ?? []).map((r: { id: string; key: string; name: string }) => ({
          id: r.id,
          name: r.name,
        }))}
      />
    </div>
  );
}
