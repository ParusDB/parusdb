"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/parus/status";
import { formatDate, formatDuration } from "@/lib/format";

// Historique des exécutions (connectors.pipeline_runs) - rafraîchi tant
// qu'un run est en file ou en cours (l'ordonnanceur dlt démarre le conteneur
// jetable puis écrit le résultat, quelques secondes de latence).

export interface RunRow {
  id: string;
  pipeline_id: string;
  pipeline_name: string;
  status: "queued" | "running" | "success" | "error";
  trigger: "creation" | "manual" | "schedule";
  message: string | null;
  rows_loaded: number | null;
  started_at: string;
  finished_at: string | null;
}

const STATUS_LABEL: Record<
  RunRow["status"],
  { tone: "active" | "error" | "queued" | "running"; label: string }
> = {
  queued: { tone: "queued", label: "En file" },
  running: { tone: "running", label: "En cours" },
  success: { tone: "active", label: "Réussi" },
  error: { tone: "error", label: "Erreur" },
};

const TRIGGER_LABEL: Record<RunRow["trigger"], string> = {
  creation: "Création",
  manual: "Manuel",
  schedule: "Planifié",
};

export function RunsPanel({ runs }: { runs: RunRow[] }) {
  const router = useRouter();
  const pending = runs.some(
    (run) => run.status === "queued" || run.status === "running",
  );

  useEffect(() => {
    if (!pending) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [pending, router]);

  if (runs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune exécution pour l’instant. Lancez un pipeline ou enregistrez-en
        un : la première exécution part automatiquement.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        <Table className="[&_th]:px-4 [&_td]:px-4">
          <TableHeader>
            <TableRow>
              <TableHead>Pipeline</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Origine</TableHead>
              <TableHead>Lignes</TableHead>
              <TableHead>Durée</TableHead>
              <TableHead>Début</TableHead>
              <TableHead className="min-w-56">Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => {
              const duration =
                run.finished_at && run.started_at
                  ? new Date(run.finished_at).getTime() -
                    new Date(run.started_at).getTime()
                  : null;
              return (
                <TableRow key={run.id}>
                  <TableCell className="font-medium">
                    {run.pipeline_name}
                  </TableCell>
                  <TableCell>
                    <StatusBadge {...STATUS_LABEL[run.status]} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {TRIGGER_LABEL[run.trigger]}
                  </TableCell>
                  <TableCell className="mono text-xs">
                    {run.rows_loaded ?? "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDuration(duration)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(run.started_at)}
                  </TableCell>
                  <TableCell className="max-w-80 truncate text-xs text-muted-foreground">
                    {run.message ?? "-"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {pending
          ? "Exécution en cours - la liste se rafraîchit automatiquement."
          : "Historique des dernières exécutions."}
      </p>
    </div>
  );
}
