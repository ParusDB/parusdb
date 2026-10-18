"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Save, X } from "lucide-react";
import {
  SOURCES,
  SOURCE_CATEGORIES,
  findSource,
} from "@/lib/sources";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createPipeline,
  testConnection,
  updatePipeline,
  type PipelineInput,
} from "@/app/(app)/connectors/actions";

export interface WizardInitial {
  name: string;
  sourceType: string;
  sourceConfig: Record<string, string>;
  selectedTables: string[];
  writeMode: "incremental" | "replace";
  cron: string;
  destinationCatalog: string;
}

const CRON_PRESETS = [
  { label: "Quotidien — minuit", value: "0 0 * * *" },
  { label: "Toutes les heures", value: "0 * * * *" },
  { label: "Hebdomadaire — dimanche", value: "0 0 * * 0" },
  { label: "Mensuel — 1er du mois", value: "0 0 1 * *" },
];

// Parcours de création d’un pipeline (spec §Connecteurs) : source ->
// credentials avec test -> tables + mode + CRON + destination -> enregistrement.
export function PipelineWizard({
  catalogs,
  pipelineId,
  initial,
}: {
  catalogs: string[];
  pipelineId?: string;
  initial?: WizardInitial;
}) {
  const isEdit = Boolean(initial);
  const [step, setStep] = useState(1);
  const [sourceKey, setSourceKey] = useState(initial?.sourceType ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [config, setConfig] = useState<Record<string, string>>(
    initial?.sourceConfig ?? {},
  );
  const [validated, setValidated] = useState(isEdit);
  const [testing, setTesting] = useState(false);
  const [selectedTables, setSelectedTables] = useState<string[]>(
    initial?.selectedTables ?? [],
  );
  const [writeMode, setWriteMode] = useState<"incremental" | "replace">(
    initial?.writeMode ?? "incremental",
  );
  const [cron, setCron] = useState(initial?.cron ?? "0 0 * * *");
  const [destination, setDestination] = useState(
    initial?.destinationCatalog ?? catalogs[0] ?? "",
  );
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const source = useMemo(() => findSource(sourceKey), [sourceKey]);

  async function handleTest() {
    if (!source) return;
    setTesting(true);
    try {
      const result = await testConnection(sourceKey, config);
      if (result.ok) {
        setValidated(true);
        toast.success("Connexion validée (simulation — dlt non intégré).");
      } else {
        setValidated(false);
        toast.error(result.error ?? "La connexion a échoué.");
      }
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (saving) return;
    if (!name.trim()) {
      toast.error("Le nom du pipeline est obligatoire.");
      return;
    }
    if (!source) {
      toast.error("Sélectionnez une source.");
      return;
    }
    if (selectedTables.length === 0) {
      toast.error("Sélectionnez au moins une table.");
      return;
    }
    if (!destination) {
      toast.error("Choisissez le catalogue de destination.");
      return;
    }
    setSaving(true);
    const input: PipelineInput = {
      name,
      sourceType: sourceKey,
      sourceConfig: config,
      selectedTables,
      writeMode,
      cron,
      destinationCatalog: destination,
    };
    try {
      if (pipelineId) {
        await updatePipeline(pipelineId, input);
      } else {
        await createPipeline(input);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "L’enregistrement a échoué.",
      );
    } finally {
      setSaving(false);
    }
  }

  const canNext =
    step === 1
      ? Boolean(sourceKey)
      : step === 2
        ? validated
        : step === 3
          ? selectedTables.length > 0 && Boolean(destination)
          : true;

  return (
    <div className="mx-auto max-w-4xl">
      {/* Étapes */}
      <ol className="mb-8 flex items-center gap-2">
        {[1, 2, 3, 4].map((n) => (
          <li
            key={n}
            className={cn(
              "mono flex flex-1 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-wider",
              step === n
                ? "border-charbon bg-charbon text-jaune"
                : step > n
                  ? "border-olive/40 bg-olive/10 text-olive"
                  : "border-border bg-card text-muted-foreground",
            )}
          >
            <span>{step > n ? <Check className="h-3 w-3" strokeWidth={2} /> : `0${n}`}</span>
            {n === 1 && "Source"}
            {n === 2 && "Connexion"}
            {n === 3 && "Données"}
            {n === 4 && "Enregistrement"}
          </li>
        ))}
      </ol>

      <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
        {/* Étape 1 : source */}
        {step === 1 ? (
          <div className="space-y-6">
            <div>
              <h2 className="font-display text-xl">Sélectionnez la source</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sources dlt disponibles (sous-ensemble Core et Verified).
              </p>
            </div>
            {SOURCE_CATEGORIES.map((category) => (
              <div key={category}>
                <p className="mono mb-2 text-[10px] uppercase tracking-[0.2em] text-olive">
                  {category}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {SOURCES.filter((s) => s.category === category).map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => {
                        setSourceKey(s.key);
                        setConfig({});
                        setValidated(isEdit);
                        setSelectedTables([]);
                      }}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-2xl border p-4 text-center transition-all hover:-translate-y-0.5",
                        sourceKey === s.key
                          ? "border-jaune bg-jaune/10"
                          : "border-border bg-card hover:border-charbon",
                      )}
                    >
                      <s.icon className="h-6 w-6 text-olive" strokeWidth={1.6} />
                      <span className="text-xs font-medium">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Étape 2 : credentials + test */}
        {step === 2 && source ? (
          <div className="space-y-5">
            <div>
              <h2 className="font-display text-xl">Credentials — {source.label}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Les credentials sont chiffrés au repos et jamais renvoyés au
                navigateur.
                {isEdit ? " Laissez vides pour conserver ceux déjà enregistrés." : ""}
              </p>
            </div>
            <div className="grid gap-2 sm:max-w-md">
              <Label htmlFor="pipeline-name">Nom du pipeline</Label>
              <Input
                id="pipeline-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ventes Stripe vers prod"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {source.fields.map((field) => (
                <div key={field.key} className="grid gap-2">
                  <Label htmlFor={`field-${field.key}`}>
                    {field.label}
                    {field.required === false ? " (optionnel)" : ""}
                  </Label>
                  <Input
                    id={`field-${field.key}`}
                    type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
                    value={config[field.key] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(e) => {
                      setConfig((prev) => ({
                        ...prev,
                        [field.key]: e.target.value,
                      }));
                      setValidated(false);
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleTest()}
                disabled={testing}
              >
                {testing ? "Test en cours…" : "Test connexion"}
              </Button>
              <p
                className={cn(
                  "mono text-xs",
                  validated ? "text-olive" : "text-muted-foreground",
                )}
              >
                {validated
                  ? "Connexion validée"
                  : "La connexion doit être validée pour continuer"}
              </p>
            </div>
          </div>
        ) : null}

        {/* Étape 3 : tables + mode + CRON + destination */}
        {step === 3 && source ? (
          <div className="space-y-6">
            <div>
              <h2 className="font-display text-xl">Données et paramètres</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Tables à charger vers le lakehouse, mode d’insertion et
                ordonnancement.
              </p>
            </div>
            <div>
              <Label className="mb-2">Tables (simulation — métadonnées de la source)</Label>
              <div className="flex flex-wrap gap-2">
                {source.sampleTables.map((table) => {
                  const selected = selectedTables.includes(table);
                  return (
                    <button
                      key={table}
                      type="button"
                      onClick={() =>
                        setSelectedTables((prev) =>
                          selected
                            ? prev.filter((t) => t !== table)
                            : [...prev, table],
                        )
                      }
                      className={cn(
                        "mono rounded-full border px-3 py-1.5 text-xs transition-colors",
                        selected
                          ? "border-jaune bg-jaune text-charbon"
                          : "border-border bg-card text-muted-foreground hover:border-charbon hover:text-foreground",
                      )}
                    >
                      {table}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <Label className="mb-2">Mode d’insertion</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    {
                      value: "incremental" as const,
                      title: "Incrémental",
                      desc: "Crée la table si absente, charge uniquement le delta depuis la dernière exécution (cursor dlt).",
                    },
                    {
                      value: "replace" as const,
                      title: "Toutes les données",
                      desc: "Recrée complètement la table à chaque exécution — signalé comme recréation totale.",
                    },
                  ]
                ).map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => setWriteMode(mode.value)}
                    className={cn(
                      "rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5",
                      writeMode === mode.value
                        ? "border-jaune bg-jaune/10"
                        : "border-border bg-card hover:border-charbon",
                    )}
                  >
                    <p className="font-medium">{mode.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{mode.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="cron">Ordonnancement (CRON)</Label>
                <Input
                  id="cron"
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="0 0 * * *"
                  className="mono"
                />
                <div className="flex flex-wrap gap-1.5">
                  {CRON_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setCron(preset.value)}
                      className="mono rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground hover:border-charbon hover:text-foreground"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Destination (catalogue lakehouse)</Label>
                <Select value={destination} onValueChange={setDestination}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choisir un catalogue" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogs.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Destination unique : le Data Lakehouse.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {/* Étape 4 : récapitulatif */}
        {step === 4 && source ? (
          <div className="space-y-5">
            <div>
              <h2 className="font-display text-xl">Vérifiez et enregistrez</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                À l’enregistrement, le pipeline est créé et une première
                exécution est lancée (simulée).
              </p>
            </div>
            <dl className="divide-y divide-border rounded-2xl border border-border">
              {[
                ["Nom", name],
                ["Source", `${source.label} (${source.category})`],
                ["Tables", selectedTables.join(", ") || "—"],
                [
                  "Mode",
                  writeMode === "incremental" ? "Incrémental" : "Toutes les données",
                ],
                ["Ordonnancement", cron || "—"],
                ["Destination", destination],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-3 gap-3 px-4 py-2.5 text-sm">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="col-span-2 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {/* Navigation */}
        <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => (step === 1 ? router.push("/connectors") : setStep(step - 1))}
          >
            {step === 1 ? (
              <>
                <X className="h-4 w-4" strokeWidth={1.8} /> Annuler
              </>
            ) : (
              <>
                <ArrowLeft className="h-4 w-4" strokeWidth={1.8} /> Retour
              </>
            )}
          </Button>
          {step < 4 ? (
            <Button
              type="button"
              disabled={!canNext}
              onClick={() => setStep(step + 1)}
              className="bg-jaune font-semibold text-charbon hover:bg-jaune/90"
            >
              Suivant <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
            </Button>
          ) : (
            <Button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="rounded-full bg-jaune font-semibold text-charbon hover:bg-jaune/90"
            >
              <Save className="h-4 w-4" strokeWidth={1.8} />
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
