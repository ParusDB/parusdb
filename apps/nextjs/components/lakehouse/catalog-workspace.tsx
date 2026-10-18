"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChevronRight,
  Database,
  Play,
  Plus,
  RefreshCw,
  Table2,
  TriangleAlert,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/parus/page-header";
import { SqlEditor } from "@/components/lakehouse/sql-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  executeQuery,
  generateBindingAction,
  type QueryExecution,
} from "@/app/(app)/data-lakehouse/actions";

export interface WorkspaceTree {
  binding: string;
  schemas: {
    name: string;
    tables: {
      name: string;
      type: string;
      columns: { name: string; type: string }[];
    }[];
  }[];
}

interface QueryTab {
  id: string;
  title: string;
  sql: string;
}

interface ExplorerState {
  openSchemas: Set<string>;
  openTables: Set<string>;
}

// Interface d’un catalogue : explorateur (schémas -> tables -> colonnes) et
// éditeur SQL avec onglets (spec §Data Lakehouse).
export function CatalogWorkspace({
  catalog,
  description,
  binding,
  tree,
  treeError,
}: {
  catalog: string;
  description: string | null;
  binding: string | null;
  tree: WorkspaceTree | null;
  treeError: string | null;
}) {
  const storageKey = `parus:sql-tabs:${catalog}`;
  const [tabs, setTabs] = useState<QueryTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [result, setResult] = useState<QueryExecution | null>(null);
  const [running, setRunning] = useState(false);
  const [explorer, setExplorer] = useState<ExplorerState>({
    openSchemas: new Set(),
    openTables: new Set(),
  });

  useEffect(() => {
    let restore: number | null = null;
    try {
      const stored = sessionStorage.getItem(storageKey);
      const parsed = stored ? (JSON.parse(stored) as QueryTab[]) : [];
      if (parsed.length > 0) {
        // Restauration après hydratation (sessionStorage = système externe) :
        // le setState passe par une frame, pas dans le corps de l'effet.
        restore = requestAnimationFrame(() => {
          setTabs(parsed);
          setActiveId(parsed[0].id);
        });
      }
    } catch {
      // stockage illisible : onglets par défaut
    }
    if (restore === null) {
      restore = requestAnimationFrame(() => {
        setTabs((current) =>
          current.length > 0
            ? current
            : [{ id: crypto.randomUUID(), title: "Requête 1", sql: "SELECT 1" }],
        );
      });
    }
    return () => {
      if (restore !== null) cancelAnimationFrame(restore);
    };
  }, [storageKey]);

  useEffect(() => {
    if (tabs.length > 0) {
      sessionStorage.setItem(storageKey, JSON.stringify(tabs));
    }
  }, [tabs, storageKey]);

  const active = tabs.find((t) => t.id === activeId) ?? null;

  function updateSql(sql: string) {
    setTabs((prev) => prev.map((t) => (t.id === activeId ? { ...t, sql } : t)));
  }

  function addTab() {
    const tab: QueryTab = {
      id: crypto.randomUUID(),
      title: `Requête ${tabs.length + 1}`,
      sql: "SELECT 1",
    };
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    setResult(null);
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) {
        setActiveId(next[0]?.id ?? null);
        setResult(null);
      }
      if (next.length === 0) {
        const initial: QueryTab[] = [
          { id: crypto.randomUUID(), title: "Requête 1", sql: "SELECT 1" },
        ];
        return initial;
      }
      return next;
    });
  }

  async function run() {
    if (!active || running) return;
    setRunning(true);
    setResult(null);
    try {
      const execution = await executeQuery(catalog, active.sql);
      setResult(execution);
      if (!execution.ok) {
        toast.error(execution.error ?? "La requête a échoué.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "La requête a échoué.",
      );
    } finally {
      setRunning(false);
    }
  }

  async function handleGenerateBinding() {
    const res = await generateBindingAction(catalog);
    if (res.ok) {
      toast.success("Fichier de configuration Trino généré.");
      toast.info(res.warning ?? "Redémarrez Trino.", { duration: 10000 });
    } else {
      toast.error(res.error ?? "La génération a échoué.");
    }
  }

  function toggleSchema(name: string) {
    setExplorer((prev) => {
      const open = new Set(prev.openSchemas);
      if (open.has(name)) open.delete(name);
      else open.add(name);
      return { ...prev, openSchemas: open };
    });
  }

  function toggleTable(key: string) {
    setExplorer((prev) => {
      const open = new Set(prev.openTables);
      if (open.has(key)) open.delete(key);
      else open.add(key);
      return { ...prev, openTables: open };
    });
  }

  function insertTableReference(schema: string, table: string) {
    const ref = binding ? `"${binding}"."${schema}"."${table}"` : `"${schema}"."${table}"`;
    updateSql(active ? `${active.sql}${active.sql.trim() ? "\n" : ""}${ref}` : ref);
  }

  return (
    <>
      <PageHeader
        eyebrow="Data Lakehouse"
        title={catalog}
        description={
          description ??
          "Éditeur SQL et explorateur : chaque requête passe par Trino avec les droits de votre rôle actif."
        }
        actions={
          <div className="flex items-center gap-2">
            {binding ? (
              <Badge variant="outline" className="mono text-[11px]">
                Trino : {binding}
              </Badge>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleGenerateBinding()}
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.6} />
                Lier à Trino
              </Button>
            )}
          </div>
        }
      />

      {!binding ? (
        <p className="mb-6 flex items-start gap-2 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-olive" strokeWidth={1.8} />
          Ce catalogue n’est pas encore chargé par Trino. Générez sa
          configuration puis redémarrez Trino :
          <code className="mono text-xs">cd apps/trino && sh run.sh restart</code>
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        {/* Explorateur */}
        <div className="rounded-3xl border border-border bg-card p-4 lg:max-h-[calc(100svh-16rem)] lg:overflow-y-auto">
          <p className="mono px-2 pb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Explorateur
          </p>
          {treeError ? (
            <p className="px-2 text-xs text-destructive">{treeError}</p>
          ) : !tree || tree.schemas.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">
              Aucun schéma. Créez des tables via l’éditeur SQL ou un connecteur
              ELT.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {tree.schemas.map((schema) => {
                const open = explorer.openSchemas.has(schema.name);
                return (
                  <li key={schema.name}>
                    <button
                      type="button"
                      onClick={() => toggleSchema(schema.name)}
                      className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                          open && "rotate-90",
                        )}
                        strokeWidth={1.8}
                      />
                      <Database className="h-4 w-4 shrink-0 text-olive" strokeWidth={1.6} />
                      <span className="mono truncate">{schema.name}</span>
                      <span className="mono ml-auto text-[10px] text-muted-foreground">
                        {schema.tables.length}
                      </span>
                    </button>
                    {open ? (
                      <ul className="ml-6 space-y-0.5">
                        {schema.tables.map((table) => {
                          const key = `${schema.name}.${table.name}`;
                          const tableOpen = explorer.openTables.has(key);
                          return (
                            <li key={key}>
                              <button
                                type="button"
                                onClick={() => toggleTable(key)}
                                className="group flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-sm hover:bg-muted"
                              >
                                <ChevronRight
                                  className={cn(
                                    "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
                                    tableOpen && "rotate-90",
                                  )}
                                  strokeWidth={1.8}
                                />
                                <Table2 className="h-3.5 w-3.5 shrink-0 text-bleu" strokeWidth={1.6} />
                                <span className="mono truncate">{table.name}</span>
                                <Plus
                                  className="ml-auto h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
                                  strokeWidth={1.8}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    insertTableReference(schema.name, table.name);
                                  }}
                                />
                              </button>
                              {tableOpen ? (
                                <ul className="ml-9 space-y-0.5 border-l border-border pl-2">
                                  {table.columns.map((column) => (
                                    <li
                                      key={column.name}
                                      className="mono flex items-baseline justify-between gap-2 px-1 py-0.5 text-[11px]"
                                    >
                                      <span className="truncate text-foreground">
                                        {column.name}
                                      </span>
                                      <span className="shrink-0 text-muted-foreground">
                                        {column.type}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Éditeur SQL */}
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  "group flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors",
                  tab.id === activeId
                    ? "border-charbon bg-charbon text-jaune"
                    : "border-border bg-card text-muted-foreground hover:border-charbon",
                )}
              >
                <button
                  type="button"
                  className="mono"
                  onClick={() => {
                    setActiveId(tab.id);
                    setResult(null);
                  }}
                >
                  {tab.title}
                </button>
                <button
                  type="button"
                  aria-label={`Fermer ${tab.title}`}
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() => closeTab(tab.id)}
                >
                  <X className="h-3 w-3" strokeWidth={1.8} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addTab}
              aria-label="Nouvel onglet de requête"
              className="shrink-0 rounded-full border border-dashed border-border p-1 text-muted-foreground hover:border-charbon hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>

          <SqlEditor
            value={active?.sql ?? ""}
            onChange={updateSql}
            onRun={run}
            disabled={!binding}
          />

          <div className="mt-3 flex items-center justify-between">
            <p className="mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Ctrl+Entrée pour exécuter · Lecture et écriture via Trino
            </p>
            <Button
              onClick={() => void run()}
              disabled={running || !active || !binding}
              className="bg-jaune font-semibold text-charbon hover:bg-jaune/90"
            >
              <Play className="h-4 w-4" strokeWidth={1.8} />
              {running ? "Exécution…" : "Exécuter"}
            </Button>
          </div>

          {/* Résultats */}
          {result ? (
            <div className="mt-4 rounded-3xl border border-border bg-card p-4">
              {result.ok ? (
                <>
                  <p className="mono mb-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    {result.rowCount} ligne{result.rowCount === 1 ? "" : "s"} ·{" "}
                    {result.durationMs} ms
                  </p>
                  {result.rowCount === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      La requête n’a renvoyé aucune ligne.
                    </p>
                  ) : (
                    <div className="max-h-80 overflow-auto rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-muted">
                          <tr>
                            {(result.columns ?? []).map((c) => (
                              <th
                                key={c.name}
                                className="mono border-b border-border px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                              >
                                {c.name}
                                <span className="ml-2 font-normal normal-case text-muted-foreground/70">
                                  {c.type}
                                </span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(result.rows ?? []).map((row, i) => (
                            <tr
                              key={i}
                              className={i % 2 === 1 ? "bg-muted/40" : undefined}
                            >
                              {row.map((cell, j) => (
                                <td
                                  key={j}
                                  className="mono border-b border-border/50 px-3 py-1.5 text-xs whitespace-nowrap"
                                >
                                  {cell === null || cell === undefined
                                    ? "NULL"
                                    : String(cell)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-destructive">{result.error}</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
