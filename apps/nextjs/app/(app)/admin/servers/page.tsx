// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { ServersView } from "@/components/admin/servers-view";
import { requirePermission } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { listModels } from "@/lib/ollama";
import type { LocalServer } from "@/types/db";

export default async function AdminServersPage() {
  await requirePermission("admin.servers");
  const admin = createAdminClient();

  const [{ data: servers }, { data: models }, ollama] = await Promise.all([
    admin.schema("admin").from("servers").select("*").order("created_at"),
    admin
      .schema("admin")
      .from("proprietary_models")
      .select("id, provider, model, created_at")
      .order("provider"),
    listModels().catch(() => []),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Administration"
        title="Serveurs locaux et modèles LLM"
        description="Infrastructures auto-hébergées : object storage S3 et serveurs d'inférence LLM. Les clés API sont chiffrées au repos et masquées dans l'interface."
      />
      <ServersView
        servers={(servers ?? []) as unknown as LocalServer[]}
        proprietaryModels={(models ?? []) as {
          id: string;
          provider: string;
          model: string;
          created_at: string;
        }[]}
        ollamaModels={ollama.map((m) => ({ name: m.name, size: m.size }))}
      />
    </div>
  );
}
