"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmNameDialog } from "@/components/parus/confirm-name-dialog";
import { cn } from "@/lib/utils";
import { addProvider, deleteProvider, updateProvider } from "@/app/(app)/admin/actions";

// Miroir client des types de lib/providers.ts (module serveur : clés
// déchiffrées côté BFF uniquement, jamais importé ici).
type ApiKind = "openai" | "anthropic" | "mistral" | "openai_compatible";

const API_KIND_LABELS: Record<ApiKind, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  mistral: "Mistral",
  openai_compatible: "Compatible OpenAI",
};

interface ProviderEntry {
  id: string;
  name: string;
  apiKind: ApiKind;
  baseUrl: string | null;
  models: string[];
  discoveryError: string | null;
  createdAt: string;
}

// Type d'API déduit du nom du fournisseur : les protocoles et endpoints
// diffèrent selon la marque (OpenAI/Anthropic/Mistral reconnus). Nom
// inconnu → null (traité en « compatible OpenAI », URL de base requise).
function inferApiKind(name: string): ApiKind | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  if (n.includes("anthropic") || n.includes("claude")) return "anthropic";
  if (n.includes("openai") || n.includes("gpt")) return "openai";
  if (n.includes("mistral")) return "mistral";
  return null;
}

export function ProvidersView({
  ollama,
  providers,
}: {
  ollama: { online: boolean; models: { name: string; size: number }[] };
  providers: ProviderEntry[];
}) {
  const [selected, setSelected] = useState<string>("ollama");
  const [editing, setEditing] = useState<ProviderEntry | "new" | null>(null);
  const router = useRouter();

  const selectedProvider = providers.find((p) => p.id === selected) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[280px,1fr]">
      {/* Colonne gauche : fournisseurs */}
      <div className="space-y-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setEditing("new")}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} /> Ajouter une clé API
        </Button>

        <button
          type="button"
          onClick={() => setSelected("ollama")}
          className={cn(
            "flex w-full flex-col rounded-3xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-charbon hover:shadow-[0_24px_60px_-30px_rgba(26,26,26,0.35)]",
            selected === "ollama" ? "border-jaune" : "border-border",
          )}
        >
          <span className="flex w-full items-start gap-3">
            <Bot className="mt-0.5 h-5 w-5 shrink-0 text-olive" strokeWidth={1.6} />
            <span className="min-w-0 flex-1 truncate font-medium">Ollama (local)</span>
            <Badge variant="outline" className="mono shrink-0 text-[10px]">
              Local
            </Badge>
          </span>
          <span className="mt-1 flex min-h-8 items-center">
            <span className="mono text-xs text-muted-foreground">
              {ollama.online
                ? `${ollama.models.length} modèle(s)`
                : "injoignable"}
            </span>
          </span>
        </button>

        {providers.map((provider) => (
          <div
            key={provider.id}
            className={cn(
              "relative rounded-3xl border bg-card p-4 transition-all",
              selected === provider.id
                ? "border-jaune"
                : "border-border hover:-translate-y-0.5 hover:border-charbon hover:shadow-[0_24px_60px_-30px_rgba(26,26,26,0.35)]",
            )}
          >
            {/* Toute la carte est cliquable (même comportement que la carte
                Ollama) ; les actions sont en surposition, frères du bouton —
                jamais imbriquées (HTML invalide). */}
            <button
              type="button"
              onClick={() => setSelected(provider.id)}
              className="flex w-full flex-col text-left"
            >
              <span className="flex w-full items-start gap-3">
                <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-olive" strokeWidth={1.6} />
                <span className="min-w-0 flex-1 truncate font-medium">{provider.name}</span>
                <Badge variant="outline" className="mono shrink-0 text-[10px]">
                  {API_KIND_LABELS[provider.apiKind]}
                </Badge>
              </span>
              <span className="mt-1 flex min-h-8 items-center pr-20">
                <span className="mono truncate text-xs text-muted-foreground">
                  {provider.discoveryError
                    ? "modèles indisponibles"
                    : `${provider.models.length} modèle(s)`}
                </span>
              </span>
            </button>
            <div className="absolute bottom-3 right-3 flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Modifier ${provider.name}`}
                onClick={() => setEditing(provider)}
              >
                <Pencil className="h-4 w-4" strokeWidth={1.6} />
              </Button>
              <ConfirmNameDialog
                title="Supprimer ce fournisseur ?"
                description={`Le fournisseur « ${provider.name} » et sa clé chiffrée seront supprimés. Les agents qui l'utilisent devront être reconfigurés.`}
                expectedName={provider.name}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="hover:text-destructive"
                    aria-label={`Supprimer ${provider.name}`}
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.6} />
                  </Button>
                }
                action={() => deleteProvider(provider.id)}
              />
            </div>
          </div>
        ))}

        {providers.length === 0 ? (
          <p className="rounded-3xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Aucun fournisseur externe configuré. Ajoutez une clé API pour
            proposer d’autres modèles aux agents.
          </p>
        ) : null}
      </div>

      {/* Colonne droite : modèles du fournisseur sélectionné */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">
            {selectedProvider ? selectedProvider.name : "Ollama (local)"}
          </h2>
          <p className="mono text-xs text-muted-foreground">
            {selectedProvider
              ? selectedProvider.discoveryError
                ? "Découverte en échec"
                : `${selectedProvider.models.length} modèle(s) découvert(s)`
              : ollama.online
                ? `${ollama.models.length} modèle(s)`
                : "Ollama injoignable"}
          </p>
        </div>

        {selectedProvider?.discoveryError ? (
          <p className="rounded-3xl border border-border bg-card p-4 text-sm text-muted-foreground">
            La découverte des modèles a échoué :{" "}
            <span className="mono text-xs">{selectedProvider.discoveryError}</span>.
            Vérifiez la clé API (« Modifier ») ou le type d’API du fournisseur.
          </p>
        ) : null}

        {!selectedProvider && !ollama.online ? (
          <p className="rounded-3xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Ollama est injoignable. Vérifiez que le service tourne
            (<code className="mono text-xs">cd apps/ollama && sh run.sh start</code>).
          </p>
        ) : null}

        {!selectedProvider && ollama.online ? (
          <p className="text-sm text-muted-foreground">
            Modèles servis par le serveur d’inférence local. Le téléchargement
            et la suppression se pilotent côté serveur Ollama
            (<code className="mono text-xs">cd apps/ollama && sh run.sh start</code>).
          </p>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modèle</TableHead>
                <TableHead>Source</TableHead>
                {selectedProvider ? <TableHead>Type d’API</TableHead> : <TableHead>Taille</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {selectedProvider ? (
                selectedProvider.models.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Aucun modèle découvert pour ce fournisseur.
                    </TableCell>
                  </TableRow>
                ) : (
                  selectedProvider.models.map((model) => (
                    <TableRow key={model}>
                      <TableCell className="mono font-medium">{model}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {selectedProvider.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="mono text-[10px]">
                          {API_KIND_LABELS[selectedProvider.apiKind]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )
              ) : ollama.models.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Aucun modèle téléchargé sur le serveur Ollama.
                  </TableCell>
                </TableRow>
              ) : (
                ollama.models.map((model) => (
                  <TableRow key={model.name}>
                    <TableCell className="mono font-medium">{model.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      Ollama (local)
                    </TableCell>
                    <TableCell className="mono text-xs">
                      {(model.size / 1024 ** 3).toFixed(1)} Go
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <ProviderDialog
        key={editing === "new" ? "new" : (editing as ProviderEntry | null)?.id ?? "closed"}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}

function ProviderDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: ProviderEntry | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = editing === "new";
  const provider = editing !== null && editing !== "new" ? editing : null;
  const [name, setName] = useState(provider?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState(false);

  // Le type d'API n'est pas demandé à l'utilisateur : il se déduit du nom du
  // fournisseur (protocoles et endpoints différents selon la marque). Un
  // nom inconnu est traité en « compatible OpenAI » (URL de base demandée),
  // sauf en édition où le type enregistré est conservé.
  const apiKind = inferApiKind(name) ?? provider?.apiKind ?? "openai_compatible";

  async function handleSubmit() {
    if (pending) return;
    if (!name.trim() || (isNew && !apiKey.trim())) {
      toast.error(
        isNew
          ? "Le nom du fournisseur et la clé API sont obligatoires."
          : "Le nom du fournisseur est obligatoire.",
      );
      return;
    }
    setPending(true);
    try {
      const result = isNew
        ? await addProvider({ name, apiKind, baseUrl, apiKey })
        : provider
          ? await updateProvider(provider.id, { name, apiKind, baseUrl, apiKey })
          : { ok: false, error: "Fournisseur introuvable." };
      if (result.ok) {
        toast.success(
          isNew
            ? `Fournisseur enregistré : ${"modelCount" in result ? result.modelCount : ""} modèle(s) découvert(s).`
            : "Fournisseur mis à jour.",
        );
        onClose();
        onSaved();
      } else {
        toast.error(result.error ?? "L'enregistrement a échoué.", { duration: 9000 });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isNew ? "Ajouter une clé API" : `Modifier ${provider?.name}`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="provider-name">Nom du fournisseur</Label>
            <Input
              id="provider-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="OpenAI, Anthropic, Mistral…"
            />
          </div>
          {apiKind === "openai_compatible" ? (
            <div className="grid gap-2">
              <Label htmlFor="provider-base-url">URL de base</Label>
              <Input
                id="provider-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.exemple.com/v1"
                className="mono"
              />
            </div>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="provider-key">
              Clé API {provider ? "(laisser vide pour conserver l'actuelle)" : ""}
            </Label>
            <Input
              id="provider-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
            />
            <p className="text-xs text-muted-foreground">
              Validée par un appel réel au fournisseur, chiffrée AES-256-GCM au
              repos. Jamais affichée ni renvoyée.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={pending}
            className="bg-jaune font-semibold text-charbon hover:bg-jaune/90"
          >
            {pending ? "Validation…" : "Valider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
