// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { SupportView } from "@/components/support/support-view";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Ticket } from "@/types/db";

export default async function SupportPage() {
  const session = await requireSession();
  const supabase = await createClient();

  // RLS : l’utilisateur voit ses tickets ; un admin (admin.users) voit tout.
  const { data: tickets } = await supabase
    .schema("support")
    .from("tickets")
    .select("id, owner_id, subject, message, status, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(50);

  // Noms des propriétaires (via l’API admin, uniquement si admin) : les
  // tickets ne portent pas de FK directe vers les profils.
  const ownerNames: Record<string, string> = {};
  if (session.has("admin.users")) {
    const admin = createAdminClient();
    const [profilesRes, usersRes] = await Promise.all([
      admin.schema("iam").from("user_profiles").select("id, first_name, last_name"),
      admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    ]);
    const profileMap = new Map(
      (profilesRes.data ?? []).map(
        (p: { id: string; first_name: string | null; last_name: string | null }) => [
          p.id,
          [p.first_name, p.last_name].filter(Boolean).join(" "),
        ],
      ),
    );
    for (const u of usersRes.data?.users ?? []) {
      ownerNames[u.id] = profileMap.get(u.id) || (u.email ?? "—");
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Support"
        title="Aide et contact"
        description="Documentation produit, ouverture de ticket. Les échanges restent sur votre infrastructure."
      />
      <SupportView
        docUrl={process.env.PARUSDB_DOC_URL ?? "https://parusdb.com"}
        tickets={(tickets ?? []) as unknown as Ticket[]}
        ownerNames={ownerNames}
        isAdmin={session.has("admin.users")}
      />
    </div>
  );
}
