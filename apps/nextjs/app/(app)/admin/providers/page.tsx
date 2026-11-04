// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { ProvidersView } from "@/components/admin/providers-view";
import { requireAdmin } from "@/lib/session";
import { listProviderDetails } from "@/lib/providers";
import { listModels } from "@/lib/ollama";

export default async function AdminProvidersPage() {
  await requireAdmin();

  const [providers, ollama] = await Promise.all([
    listProviderDetails(),
    listModels().catch(() => null),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Administration"
        title="Fournisseurs et modèles LLM"
        description="Ollama (local) est embarqué par ParusDB ; ajoutez des fournisseurs externes par clé API. Les modèles sont découverts dynamiquement, les clés sont chiffrées au repos et masquées dans l'interface."
      />
      <ProvidersView
        ollama={
          ollama
            ? { online: true, models: ollama.map((m) => ({ name: m.name, size: m.size })) }
            : { online: false, models: [] }
        }
        providers={providers}
      />
    </div>
  );
}
