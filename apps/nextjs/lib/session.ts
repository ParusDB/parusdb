import { createClient } from "@/lib/supabase/server";
import type { Role, UserProfile } from "@/types/db";
import { redirect } from "next/navigation";

export interface SessionContext {
  userId: string;
  email: string;
  profile: UserProfile | null;
  roles: Role[];
  activeRole: Role | null;
  // Le compte porte le rôle système `admin` (hérite de tout, RBAC refonte —
  // docs/functional/rbac_refonte.md). Indépendant du rôle actif :
  // l'administration est une capacité du compte.
  isAdmin: boolean;
}

export type ResourceType = "catalog" | "agent" | "pipeline";
export type Privilege = "read" | "write" | "manage";

// Contexte de session côté serveur : utilisateur, rôles attribués et rôle
// actif. Toute décision d'accès passe par ici ou par la RLS (jamais par un
// état client, AGENTS.md §7).
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
  const activeRole = roles.find((r) => r.id === activeRoleId) ?? roles[0] ?? null;

  return {
    userId: user.id,
    email: user.email ?? "",
    profile: (profileRes.data as unknown as UserProfile) ?? null,
    roles,
    activeRole,
    isAdmin: roles.some((r) => r.key === "admin"),
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

// Administration exigée : redirige vers le chat si le compte ne porte pas
// le rôle admin.
export async function requireAdmin(): Promise<SessionContext> {
  const session = await requireSession();
  if (!session.isAdmin) {
    redirect("/chat");
    throw new Error("Rôle administrateur requis.");
  }
  return session;
}

// Décision d'accès RBAC (iam.has_grant, SECURITY DEFINER côté base) :
// admin, propriété du rôle actif ou grant couvrant le privilège demandé.
export async function hasGrant(
  userId: string,
  resourceType: ResourceType,
  resourceId: string,
  privilege: Privilege,
): Promise<boolean> {
  const supabase = await createClient();
  // Schéma `iam` explicite : PostgREST ne résout pas les fonctions non
  // qualifiées hors de `public` (PGRST202 sinon).
  const { data, error } = await supabase.schema("iam").rpc("has_grant", {
    p_user: userId,
    p_resource_type: resourceType,
    p_resource_id: resourceId,
    p_privilege: privilege,
  });
  if (error) {
    throw new Error(
      `La vérification des droits a échoué : ${error.message}`,
    );
  }
  return data === true;
}

// Session + droit exigés : redirige vers le chat si le rôle actif n'a pas
// le privilège sur la ressource.
export async function requireGrant(
  resourceType: ResourceType,
  resourceId: string,
  privilege: Privilege,
): Promise<SessionContext> {
  const session = await requireSession();
  const granted = await hasGrant(
    session.userId,
    resourceType,
    resourceId,
    privilege,
  );
  if (!granted) {
    redirect("/chat");
    throw new Error("Droits insuffisants pour cette ressource.");
  }
  return session;
}
