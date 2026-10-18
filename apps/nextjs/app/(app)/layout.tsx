import { Sidebar, type SidebarProps } from "@/components/layout/sidebar";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// Layout protégé : toute décision d'accès est vérifiée côté serveur
// (AGENTS.md §7) — pas de session, pas de contenu. Les pages de ce groupe
// lisent la session (cookies) : rendu bloquant à la requête, pas de shell
// statique.
export const instant = false;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const supabase = await createClient();

  const [conversationsRes, agentsRes] = await Promise.all([
    session.has("chat")
      ? supabase
          .schema("chat")
          .from("conversations")
          .select("id, title")
          .order("updated_at", { ascending: false })
          .limit(15)
      : Promise.resolve({ data: [] }),
    session.has("agents")
      ? supabase
          .schema("agents")
          .from("agents")
          .select("id, name")
          .order("created_at", { ascending: false })
          .limit(15)
      : Promise.resolve({ data: [] }),
  ]);

  const sidebarProps: SidebarProps = {
    user: {
      email: session.email,
      firstName: session.profile?.first_name ?? null,
      lastName: session.profile?.last_name ?? null,
    },
    roles: session.roles.map((r) => ({ id: r.id, name: r.name })),
    activeRoleId: session.activeRole?.id ?? null,
    permissions: session.permissions,
    conversations: (conversationsRes.data ?? []).map((c: { id: string; title: string | null }) => ({
      id: c.id,
      title: c.title,
    })),
    agents: (agentsRes.data ?? []).map((a: { id: string; name: string }) => ({
      id: a.id,
      name: a.name,
    })),
  };

  if (session.roles.length === 0) {
    // Aucun rôle attribué : aucune section accessible — signaler clairement.
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
