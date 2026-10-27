"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Database, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  createAgent,
  updateAgent,
  type AgentInput,
} from "@/app/(app)/agents/actions";

export interface AgentFormProps {
  agentId?: string;
  initial?: {
    name: string;
    description: string;
    model_provider: string;
    model_id: string;
    system_prompt: string;
    sources: string[];
  };
  modelSources: { value: string; label: string; models: string[] }[];
  catalogs: string[];
}

export function AgentForm({ agentId, initial, modelSources, catalogs }: AgentFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [provider, setProvider] = useState(
    initial?.model_provider || "ollama",
  );
  const [model, setModel] = useState(initial?.model_id ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? "");
  const [sources, setSources] = useState<string[]>(initial?.sources ?? []);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  // Sources de modèles + la source d'un agent dont le fournisseur a été
  // supprimé en administration (libellé explicite plutôt qu'un select vide).
  const availableSources = [...modelSources];
  if (
    initial?.model_provider &&
    initial.model_provider !== "ollama" &&
    !availableSources.some((s) => s.value === initial.model_provider)
  ) {
    availableSources.push({
      value: initial.model_provider,
      label: "Source supprimée",
      models: [],
    });
  }

  const providerModels =
    availableSources.find((s) => s.value === provider)?.models ?? [];

  function toggleSource(catalog: string) {
    setSources((prev) =>
      prev.includes(catalog)
        ? prev.filter((c) => c !== catalog)
        : [...prev, catalog],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!name.trim()) {
      toast.error("Le nom de l’agent est obligatoire.");
      return;
    }
    if (!model.trim()) {
      toast.error("Sélectionnez un modèle LLM.");
      return;
    }
    setPending(true);
    const input: AgentInput = {
      name,
      description,
      model_provider: provider,
      model_id: model,
      system_prompt: systemPrompt,
      sources,
    };
    try {
      if (agentId) {
        await updateAgent(agentId, input);
      } else {
        await createAgent(input);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "L’enregistrement a échoué.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="name">Nom</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Analyste commercial"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Répond aux questions sur les ventes"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>Source du modèle</Label>
          <Select
            value={provider}
            onValueChange={(v) => {
              setProvider(v);
              setModel("");
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choisir une source" />
            </SelectTrigger>
            <SelectContent>
              {availableSources.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Modèle</Label>
          {providerModels.length > 0 ? (
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choisir un modèle" />
              </SelectTrigger>
              <SelectContent>
                {providerModels.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Identifiant du modèle (ex. gpt-5.3)"
            />
          )}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="system-prompt">Prompt système</Label>
        <Textarea
          id="system-prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Ex. : Tu es un analyste commercial. Réponds avec des montants en euros et des périodes explicites."
          className="min-h-32"
        />
        <p className="text-xs text-muted-foreground">
          Instructions métier données au modèle. Le socle ParusDB (accès au
          lakehouse via les outils MCP, réponse en français) est ajouté
          automatiquement.
        </p>
      </div>

      <div className="grid gap-2">
        <Label className="flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5 text-olive" strokeWidth={1.6} />
          Sources de connaissances (catalogues autorisés à votre rôle actif)
        </Label>
        {catalogs.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            Aucun catalogue accessible : créez-en un dans le Data Lakehouse ou
            demandez l’accès à un administrateur.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {catalogs.map((catalog) => {
              const selected = sources.includes(catalog);
              return (
                <button
                  key={catalog}
                  type="button"
                  onClick={() => toggleSource(catalog)}
                  aria-pressed={selected}
                  className={cn(
                    "mono rounded-full border px-3 py-1.5 text-xs transition-colors",
                    selected
                      ? "border-jaune bg-jaune text-charbon"
                      : "border-border bg-card text-muted-foreground hover:border-charbon hover:text-foreground",
                  )}
                >
                  {catalog}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-6">
        <Button
          type="submit"
          disabled={pending}
          className="rounded-full bg-jaune font-semibold text-charbon hover:bg-jaune/90"
        >
          <Save className="h-4 w-4" strokeWidth={1.8} />
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/agents")}>
          <X className="h-4 w-4" strokeWidth={1.8} /> Annuler
        </Button>
      </div>
    </form>
  );
}
