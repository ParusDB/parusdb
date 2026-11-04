// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { AgentForm } from "@/components/agents/agent-form";
import { requireSession } from "@/lib/session";
import { readableCatalogNames } from "@/lib/rbac";
import { listModelSources } from "@/lib/providers";

export default async function NewAgentPage() {
  await requireSession();

  const [modelSources, catalogs] = await Promise.all([
    listModelSources(),
    // Sources de connaissances : catalogues lisibles par le rôle actif
    // (filtrés par la RLS du registre).
    readableCatalogNames().catch(() => [] as string[]),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Agents IA"
        title="Nouvel agent IA"
        description="Nom, modèle LLM, prompt système et sources : tout est stocké côté serveur, les prompts sont des données. Votre rôle actif en devient propriétaire."
      />
      <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
        <AgentForm modelSources={modelSources} catalogs={catalogs} />
      </div>
    </div>
  );
}
