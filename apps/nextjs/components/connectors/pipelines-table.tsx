"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pause, Pencil, Play, Plug, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { CharbonPanel } from "@/components/parus/charbon-panel";
import { StatusBadge } from "@/components/parus/status";
import { ConfirmNameDialog } from "@/components/parus/confirm-name-dialog";
import { formatDate } from "@/lib/format";
import {
  deletePipeline,
  runPipeline,
  togglePipeline,
} from "@/app/(app)/connectors/actions";

export interface PipelineRow {
  id: string;
  name: string;
  source_type: string;
  sourceLabel: string;
  destination_catalog: string;
  destination_schema: string | null;
  status: "active" | "inactive" | "error";
  cron: string;
  last_run_at: string | null;
  created_at: string;
  isOwner: boolean;
}

const STATUS_LABEL: Record<PipelineRow["status"], { tone: "active" | "inactive" | "error"; label: string }> = {
  active: { tone: "active", label: "Actif" },
  inactive: { tone: "inactive", label: "Inactif" },
  error: { tone: "error", label: "Erreur" },
};

export function PipelinesTable({
  pipelines,
  catalogs,
}: {
  pipelines: PipelineRow[];
  catalogs: string[];
}) {
  const router = useRouter();

  async function handleRun(id: string) {
    const result = await runPipeline(id);
    if (result.ok) {
      toast.success(
        "Exécution mise en file — l'ordonnanceur dlt la démarre dans quelques secondes.",
      );
      router.refresh();
    } else {
      toast.error(result.error ?? "L’exécution a échoué.");
    }
  }

  async function handleToggle(row: PipelineRow) {
    const next = row.status === "active" ? "inactive" : "active";
    const result = await togglePipeline(row.id, next);
    if (result.ok) {
      toast.success(next === "active" ? "Pipeline réactivé." : "Pipeline désactivé.");
      router.refresh();
    } else {
      toast.error(result.error ?? "Le changement d'état a échoué.");
    }
  }

  return (
    <div className="space-y-4">
      {pipelines.length === 0 ? (
        <CharbonPanel className="text-center">
          <h2 className="font-display text-2xl">Aucun pipeline</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-blanc/70">
            Connectez une première source : sélectionnez les tables, choisissez
            le mode d’insertion et l’ordonnancement CRON.
          </p>
          <Button
            asChild
            className="mt-6 rounded-full bg-jaune font-semibold text-charbon shadow-[0_20px_60px_-20px_rgba(255,215,0,0.5)] transition-transform hover:-translate-y-0.5"
          >
            <Link href="/connectors/new">Connecter une source</Link>
          </Button>
        </CharbonPanel>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Créé le</TableHead>
                <TableHead>Dernière exécution</TableHead>
                <TableHead>CRON</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pipelines.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      <Plug className="h-4 w-4 text-olive" strokeWidth={1.6} />
                      {row.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.sourceLabel}
                  </TableCell>
                  <TableCell className="mono text-xs">
                    {row.destination_catalog}
                    {row.destination_schema ? `.${row.destination_schema}` : ""}
                  </TableCell>
                  <TableCell>
                    <StatusBadge {...STATUS_LABEL[row.status]} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(row.created_at)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(row.last_run_at)}
                  </TableCell>
                  <TableCell className="mono text-xs">
                    {row.cron || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button asChild variant="ghost" size="icon-sm" aria-label="Modifier le pipeline">
                        <Link href={`/connectors/${row.id}`}>
                          <Pencil className="h-4 w-4" strokeWidth={1.6} />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Lancer le pipeline"
                        onClick={() => void handleRun(row.id)}
                      >
                        <Play className="h-4 w-4" strokeWidth={1.6} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={row.status === "active" ? "Désactiver le pipeline" : "Activer le pipeline"}
                        onClick={() => void handleToggle(row)}
                      >
                        <Pause className="h-4 w-4" strokeWidth={1.6} />
                      </Button>
                      <ConfirmNameDialog
                        title="Supprimer ce pipeline ?"
                        description={`Le pipeline « ${row.name} » et son historique d’exécution seront supprimés.`}
                        expectedName={row.name}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="hover:text-destructive"
                            aria-label={`Supprimer le pipeline ${row.name}`}
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.6} />
                          </Button>
                        }
                        action={() => deletePipeline(row.id)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {catalogs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun catalogue de destination : créez-en un dans le{" "}
          <Link href="/data-lakehouse" className="underline underline-offset-4">
            Data Lakehouse
          </Link>{" "}
          avant de connecter une source.
        </p>
      ) : null}
    </div>
  );
}
