"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Database,
  FileText,
  HardDrive,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/parus/page-header";
import { CharbonPanel } from "@/components/parus/charbon-panel";
import { ConfirmNameDialog } from "@/components/parus/confirm-name-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes, formatDate } from "@/lib/format";
import {
  createCatalogAction,
  deleteCatalogAction,
} from "@/app/(app)/data-lakehouse/actions";

export interface CatalogCard {
  name: string;
  description: string | null;
  createdAt: string | null;
  binding: string | null;
  isDefault: boolean;
}

export function CatalogsView({
  catalogs,
  metrics,
  polarisError,
  trinoError,
  isAdmin,
  boundCount,
}: {
  catalogs: CatalogCard[];
  metrics: {
    catalogs: number;
    tables: number;
    files: number;
    bytes: number;
    queries: number;
  };
  polarisError: string | null;
  trinoError: string | null;
  isAdmin: boolean;
  boundCount: number;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleCreate() {
    if (pending) return;
    setPending(true);
    try {
      const result = await createCatalogAction(name, description);
      if (result.ok) {
        toast.success(`Catalogue « ${name.trim()} » créé.`);
        if (result.warning) toast.info(result.warning, { duration: 10000 });
        setCreateOpen(false);
        setName("");
        setDescription("");
        router.refresh();
      } else {
        toast.error(result.error ?? "La création a échoué.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "La création a échoué.",
      );
    } finally {
      setPending(false);
    }
  }

  const cards = [
    { label: "Catalogues", value: String(metrics.catalogs), icon: Database },
    { label: "Tables", value: String(metrics.tables), icon: Play },
    { label: "Espace disque", value: formatBytes(metrics.bytes), icon: HardDrive },
    { label: "Fichiers Iceberg", value: String(metrics.files), icon: FileText },
    { label: "Requêtes exécutées", value: String(metrics.queries), icon: Search },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Data Lakehouse"
        title="Catalogues"
        description="Polaris catalogue les métadonnées Iceberg, Trino exécute le SQL, RustFS stocke les fichiers. Aucune donnée analytique ne vit dans PostgreSQL."
        actions={
          <Button
            onClick={() => setCreateOpen(true)}
            className="rounded-full bg-jaune font-semibold text-charbon hover:bg-jaune/90"
          >
            <Plus strokeWidth={1.8} /> Créer un catalogue
          </Button>
        }
      />

      {polarisError ? (
        <p className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {polarisError}
        </p>
      ) : null}
      {trinoError ? (
        <p className="mb-6 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Métriques incomplètes : {trinoError}
        </p>
      ) : null}

      {/* Métriques globales */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-3xl border border-border bg-card p-5"
          >
            <card.icon className="h-5 w-5 text-olive" strokeWidth={1.6} />
            <p className="mt-3 font-display text-2xl">{card.value}</p>
            <p className="mono mt-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {card.label}
            </p>
          </div>
        ))}
      </div>

      {/* Liste des catalogues */}
      <div className="mt-8">
        {catalogs.length === 0 && !polarisError ? (
          <CharbonPanel size="lg" className="text-center">
            <h2 className="font-display text-3xl">Aucun catalogue</h2>
            <p className="mx-auto mt-3 max-w-lg text-sm text-blanc/70">
              Votre lakehouse est prêt mais vide. Créez un premier catalogue,
              puis connectez une source pour le remplir via un connecteur ELT.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button
                onClick={() => setCreateOpen(true)}
                className="rounded-full bg-jaune font-semibold text-charbon shadow-[0_20px_60px_-20px_rgba(255,215,0,0.5)] transition-transform hover:-translate-y-0.5"
              >
                Créer un catalogue
              </Button>
              <Button
                asChild
                variant="outline"
                className="rounded-full border-white/20 text-blanc hover:bg-white/5"
              >
                <Link href="/connectors">Créer un premier connecteur</Link>
              </Button>
            </div>
          </CharbonPanel>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {catalogs.map((catalog) => (
              <div
                key={catalog.name}
                className="group flex flex-col rounded-3xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:border-charbon hover:shadow-[0_24px_60px_-30px_rgba(26,26,26,0.35)]"
              >
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-jaune text-charbon">
                  <Database className="h-6 w-6" strokeWidth={1.6} />
                </div>
                <div className="flex items-center gap-2">
                  <h3 className="mono font-display text-xl">{catalog.name}</h3>
                  {catalog.isDefault ? (
                    <Badge className="mono bg-bleu text-[10px] text-white">
                      défaut
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-2.5 line-clamp-3 min-h-10 text-sm text-muted-foreground">
                  {catalog.description ?? "Aucune description."}
                </p>
                <p className="mono mt-3 text-xs text-muted-foreground">
                  {catalog.binding
                    ? `Trino : ${catalog.binding}`
                    : "Non lié à Trino"}
                  {catalog.createdAt ? ` · ${formatDate(catalog.createdAt)}` : ""}
                </p>
                <div className="mt-5 flex items-center gap-1.5 border-t border-border pt-4">
                  <Button asChild variant="outline" size="sm" className="flex-1">
                    <Link href={`/data-lakehouse/${catalog.name}`}>
                      <Play className="h-3.5 w-3.5" strokeWidth={1.6} /> Ouvrir
                    </Link>
                  </Button>
                  {isAdmin && !catalog.isDefault ? (
                    <ConfirmNameDialog
                      title="Supprimer ce catalogue ?"
                      description={`Le catalogue Polaris « ${catalog.name} », ses schémas, ses tables et tous les fichiers Iceberg associés seront purgés.`}
                      expectedName={catalog.name}
                      trigger={
                        <Button
                          variant="outline"
                          size="icon-sm"
                          className="hover:text-destructive"
                          aria-label={`Supprimer le catalogue ${catalog.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
                        </Button>
                      }
                      action={() => deleteCatalogAction(catalog.name)}
                    />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="mono mt-8 text-xs text-muted-foreground">
        {boundCount} catalogue{boundCount > 1 ? "s" : ""} lié
        {boundCount > 1 ? "s" : ""} à Trino · Les nouveaux catalogues exigent un
        redémarrage Trino (cd apps/trino && sh run.sh restart).
      </p>

      {/* Dialog de création */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Créer un catalogue</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="catalog-name">Nom (snake_case)</Label>
              <Input
                id="catalog-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="prod, stg, analytics…"
              />
              <p className="text-xs text-muted-foreground">
                Identifiant en minuscules : lettres, chiffres, tirets bas.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="catalog-description">Description</Label>
              <Textarea
                id="catalog-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Catalogue de production"
                className="min-h-20"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={handleCreate}
              disabled={pending || name.trim().length === 0}
              className="bg-jaune font-semibold text-charbon hover:bg-jaune/90"
            >
              {pending ? "Création…" : "Créer le catalogue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
