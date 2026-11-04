// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { PipelineWizard } from "@/components/connectors/pipeline-wizard";
import { requireSession } from "@/lib/session";
import { writableCatalogNames } from "@/lib/rbac";

export default async function NewPipelinePage() {
  const session = await requireSession();

  // Destination d'ingestion : uniquement les catalogues où le rôle actif
  // dispose du privilège « Écriture » (RBAC refonte).
  const catalogs = await writableCatalogNames(session).catch(
    () => [] as string[],
  );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Connecteurs ELT"
        title="Connecter une source"
        description="Quatre étapes : source, credentials avec test de connexion, sélection des données, enregistrement. Votre rôle actif devient propriétaire du pipeline."
      />
      <PipelineWizard catalogs={catalogs} />
    </div>
  );
}
