import { Sidebar, type SidebarProps } from "@/components/layout/sidebar";
import { requireSession } from "@/lib/session";
import { can, grantsForActiveRole } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// Layout protégé : toute décision d'accès est vérifiée côté serveur
// (AGENTS.md §7) - pas de session, pas de contenu. Les pages de ce groupe
// lisent la session (cookies) : rendu bloquant à la requête, pas de shell
// statique.
export const instant = false;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Le prerender dev est arrêté dans getSessionContext (connection() avant
  // tout accès session) : cf. lib/session.ts.
  const session = await requireSession();
  const supabase = await createClient();

  // Les menus sont visibles par tous les comptes authentifiés (RBAC
  // refonte) : le CONTENU est filtré par le rôle actif via la RLS. Les
  // conversations incluent celles partagées au rôle actif (lecture seule).
  const [conversationsRes, agentsRes, grants] = await Promise.all([
    supabase
      .schema("chat")
      .from("conversations")
      .select("id, title, owner_id")
      .order("updated_at", { ascending: false })
      .limit(15),
    supabase
      .schema("agents")
      .from("agents")
      .select("id, name, owner_role_id")
      .order("created_at", { ascending: false })
      .limit(15),
    grantsForActiveRole(session).catch(() => []),
  ]);

  const sidebarProps: SidebarProps = {
    user: {
      email: session.email,
      firstName: session.profile?.first_name ?? null,
      lastName: session.profile?.last_name ?? null,
    },
    roles: session.roles.map((r) => ({ id: r.id, name: r.name })),
    activeRoleId: session.activeRole?.id ?? null,
    isAdmin: session.isAdmin,
    conversations: (conversationsRes.data ?? []).map(
      (c: { id: string; title: string | null; owner_id: string }) => ({
        id: c.id,
        title: c.title,
        owned: c.owner_id === session.userId,
      }),
    ),
    agents: (agentsRes.data ?? []).map(
      (a: { id: string; name: string; owner_role_id: string | null }) => ({
        id: a.id,
        name: a.name,
        canRename: can(
          session,
          grants,
          "agent",
          a.id,
          a.owner_role_id,
          "write",
        ),
        canDelete: can(
          session,
          grants,
          "agent",
          a.id,
          a.owner_role_id,
          "manage",
        ),
      }),
    ),
  };

  if (session.roles.length === 0) {
    // Aucun rôle attribué : aucune section accessible - signaler clairement.
    redirect("/auth/error?error=Aucun%20r%C3%B4le%20attribu%C3%A9%20au%20compte");
  }

  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      <Sidebar session={sidebarProps} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
        {children}
      </main>
    </div>
  );
}
