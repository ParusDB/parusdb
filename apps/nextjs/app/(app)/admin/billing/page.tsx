// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { PageHeader } from "@/components/parus/page-header";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { computeCatalogStats, loadCatalogViews } from "@/lib/lakehouse";
import type { CatalogEntry } from "@/types/db";
import { formatBytes, formatDuration } from "@/lib/format";
import { Bot, Coins, Database, MessageSquare, Play } from "lucide-react";

// Facturation : métriques d'usage de la plateforme. Section en cours de
// définition côté spec (modèle économique à affiner) — les compteurs sont
// réels, issus des tables applicatives et du lakehouse.
export default async function BillingPage() {
  const session = await requirePermission("admin.billing");
  const supabase = await createClient();

  // Agrégats via la fonction admin.usage_metrics (RPC, permission vérifiée).
  const { data: metrics } = await supabase.rpc("usage_metrics");
  const m = (metrics ?? []) as {
    llm_duration_ms: number;
    llm_tokens: number;
    trino_queries: number;
    active_pipelines: number;
    conversations: number;
  }[];
  const usage = m[0] ?? {
    llm_duration_ms: 0,
    llm_tokens: 0,
    trino_queries: 0,
    active_pipelines: 0,
    conversations: 0,
  };

  // Espace disque lakehouse (catalogues liés à Trino).
  let storageBytes = 0;
  let storageError: string | null = null;
  try {
    const { data: registryRows } = await supabase
      .schema("lakehouse")
      .from("catalog_registry")
      .select("catalog_name, description, created_by, created_at, updated_at");
    const registry = (registryRows ?? []) as unknown as CatalogEntry[];
    const catalogs = await loadCatalogViews(registry);
    const stats = await Promise.all(
      catalogs
        .filter((c) => c.binding)
        .map((c) => computeCatalogStats(c.binding as string)),
    );
    for (const s of stats) storageBytes += s.bytes;
  } catch (error) {
    storageError =
      error instanceof Error ? error.message : "Trino est injoignable.";
  }

  const cards = [
    {
      label: "Stockage lakehouse",
      value: storageError ? "—" : formatBytes(storageBytes),
      icon: Database,
      hint: storageError ?? "Fichiers Iceberg (RustFS)",
    },
    {
      label: "Requêtes Trino",
      value: String(usage.trino_queries),
      icon: Play,
      hint: "Éditeur SQL + chat IA",
    },
    {
      label: "Temps d'exécution LLM",
      value: formatDuration(usage.llm_duration_ms),
      icon: Bot,
      hint: `${usage.llm_tokens} tokens cumulés`,
    },
    {
      label: "Pipelines actifs",
      value: String(usage.active_pipelines),
      icon: Coins,
      hint: "Ordonnancement CRON actif",
    },
    {
      label: "Conversations",
      value: String(usage.conversations),
      icon: MessageSquare,
      hint: "Tous propriétaires confondus",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Administration"
        title="Facturation"
        description="Compteurs d'usage de la plateforme. Le modèle économique est en cours de définition : ces métriques alimenteront les futurs forfaits."
      />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-3xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:border-charbon hover:shadow-[0_24px_60px_-30px_rgba(26,26,26,0.35)]"
          >
            <card.icon className="h-5 w-5 text-olive" strokeWidth={1.6} />
            <p className="mt-3 font-display text-3xl">{card.value}</p>
            <p className="mono mt-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {card.label}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{card.hint}</p>
          </div>
        ))}
      </div>
      <p className="mono mt-8 text-xs text-muted-foreground">
        Role actif : {session.activeRole?.name ?? "—"} · Les compteurs sont
        agrégés au niveau de la plateforme, sans jamais exposer les prompts des
        utilisateurs (RGPD).
      </p>
    </div>
  );
}
