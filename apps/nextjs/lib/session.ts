import { createClient } from "@/lib/supabase/server";
import type { Role, UserProfile } from "@/types/db";
import { redirect } from "next/navigation";

export interface SessionContext {
  userId: string;
  email: string;
  profile: UserProfile | null;
  roles: Role[];
  activeRole: Role | null;
  permissions: string[];
  has(permission: string): boolean;
}

// Contexte de session côté serveur : utilisateur, rôles attribués, rôle actif
// et permissions effectives. Toute décision d'accès passe par ici (jamais par
// un état client, AGENTS.md §7).
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const iam = supabase.schema("iam");
  const [profileRes, userRolesRes, activeRes] = await Promise.all([
    iam.from("user_profiles").select("*").eq("id", user.id).maybeSingle(),
    iam
      .from("user_roles")
      .select("granted_at, roles(*)")
      .eq("user_id", user.id)
      .order("granted_at"),
    iam
      .from("user_active_role")
      .select("role_id")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const roles: Role[] = (userRolesRes.data ?? [])
    .map((row) => row.roles as unknown as Role)
    .filter(Boolean);
  const activeRoleId = activeRes.data?.role_id ?? null;
  const activeRole =
    roles.find((r) => r.id === activeRoleId) ?? roles[0] ?? null;
  const permissions = activeRole?.permissions ?? [];

  return {
    userId: user.id,
    email: user.email ?? "",
    profile: (profileRes.data as unknown as UserProfile) ?? null,
    roles,
    activeRole,
    permissions,
    has: (permission: string) => permissions.includes(permission),
  };
}

// Session exigée : redirige vers /auth/login si non authentifié.
export async function requireSession(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) {
    redirect("/auth/login");
    throw new Error("Redirection vers la connexion.");
  }
  return session;
}

// Session + permission exigées : redirige vers le chat si la permission manque.
export async function requirePermission(
  permission: string,
): Promise<SessionContext> {
  const session = await requireSession();
  if (!session.has(permission)) {
    redirect("/chat");
    throw new Error("Permission manquante.");
  }
  return session;
}
