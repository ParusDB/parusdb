// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { ConnectionInfoView } from "@/components/admin/connection-info-view";
import { requireAdmin } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getConnectionEndpoints, getS3Keys } from "@/lib/connection-info";
import type { AppUser } from "@/types/db";

export default async function AdminInformationsPage() {
  await requireAdmin();
  const admin = createAdminClient();

  // Comptes applicatifs : catalogues accessibles au rôle de chacun (grants).
  const [{ data: appUserRows }, { data: roles }, { data: grants }] =
    await Promise.all([
      admin
        .schema("iam")
        .from("app_users")
        .select("id, name, polaris_client_id, role_id")
        .order("created_at"),
      admin.schema("iam").from("roles").select("id, key, name"),
      admin
        .schema("iam")
        .from("grants")
        .select("role_id, resource_type, resource_id")
        .eq("resource_type", "catalog"),
    ]);

  const roleMap = new Map(
    (roles ?? []).map((r: { id: string; key: string; name: string }) => [
      r.id,
      r,
    ]),
  );
  const catalogsByRole = new Map<string, string[]>();
  for (const g of (grants ?? []) as {
    role_id: string;
    resource_id: string;
  }[]) {
    const list = catalogsByRole.get(g.role_id) ?? [];
    list.push(g.resource_id);
    catalogsByRole.set(g.role_id, list);
  }

  const appUsers = (appUserRows ?? []).map((a) => {
    const row = a as unknown as AppUser;
    const role = roleMap.get(row.role_id);
    return {
      id: row.id,
      name: row.name,
      clientId: row.polaris_client_id,
      roleKey: role?.key ?? "",
      roleName: role?.name ?? "Rôle",
      catalogs: [...new Set(catalogsByRole.get(row.role_id) ?? [])].sort(),
    };
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Administration"
        title="Informations"
        description="Connectez vos outils data (dbt, Power BI, Airbyte, Spark, Flink, pyiceberg…) au lakehouse. Les credentials vivent dans les utilisateurs applicatifs — jamais le compte root."
      />
      <ConnectionInfoView
        endpoints={getConnectionEndpoints()}
        appUsers={appUsers}
        s3Keys={getS3Keys()}
      />
    </div>
  );
}
