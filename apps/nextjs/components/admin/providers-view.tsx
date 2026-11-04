"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Download, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
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
import { addProvider, deleteOllamaModel, deleteProvider, updateProvider } from "@/app/(app)/admin/actions";

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
  const [pullOpen, setPullOpen] = useState(false);
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
            "flex w-full flex-col rounded-3xl border bg-card p-4 text-left transition-all",
            selected === "ollama"
              ? "border-jaune"
              : "border-border hover:-translate-y-0.5 hover:border-charbon hover:shadow-[0_24px_60px_-30px_rgba(26,26,26,0.35)]",
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
                Ollama) ; les actions sont en surposition, frères du bouton -
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
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg">
            {selectedProvider ? selectedProvider.name : "Ollama (local)"}
          </h2>
          <div className="flex items-center gap-3">
            {!selectedProvider && ollama.online ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPullOpen(true)}
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.8} />{" "}
                Télécharger un modèle
              </Button>
            ) : null}
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
            Modèles servis par le serveur d’inférence local. Téléchargez un
            nouveau modèle depuis la bibliothèque Ollama
            (<code className="mono text-xs">ollama.com</code>) ou supprimez
            ceux qui ne servent plus.
          </p>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-border bg-card">
          <Table className="[&_th]:px-4 [&_td]:px-4">
            <TableHeader>
              <TableRow>
                <TableHead>Modèle</TableHead>
                <TableHead>Source</TableHead>
                {selectedProvider ? <TableHead>Type d’API</TableHead> : <TableHead>Taille</TableHead>}
                {!selectedProvider ? <TableHead className="w-16">Actions</TableHead> : null}
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
                    colSpan={4}
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
                    <TableCell>
                      <ConfirmNameDialog
                        title="Supprimer ce modèle ?"
                        description={`Le modèle « ${model.name} » sera supprimé du serveur Ollama et son emprise disque libérée. Action irréversible, refusée si des agents l'utilisent encore.`}
                        expectedName={model.name}
                        confirmLabel="Supprimer"
                        action={() => deleteOllamaModel(model.name)}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="hover:text-destructive"
                            aria-label={`Supprimer ${model.name}`}
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.6} />
                          </Button>
                        }
                      />
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

      <PullModelDialog
        key={`pull-${pullOpen ? "open" : "closed"}`}
        open={pullOpen}
        onClose={() => setPullOpen(false)}
        onDone={() => router.refresh()}
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

// Évènement relayé par le Route Handler /admin/providers/pull (une ligne JSON).
interface PullEvent {
  type: "log" | "progress" | "success" | "error";
  message?: string;
  digest?: string;
  total?: number;
  completed?: number;
}

// Téléchargement d'un modèle Ollama (spec §Fournisseurs LLM) : saisie du nom
// tel que publié sur ollama.com, progression en temps réel (barre + logs
// Ollama bruts) via le flux NDJSON du BFF. La fermeture du dialog interrompt
// le téléchargement (abort).
function PullModelDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  // Défilement automatique vers la dernière ligne de log.
  useEffect(() => {
    const el = logsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  function close() {
    abortRef.current?.abort();
    onClose();
  }

  async function handlePull() {
    if (running) return;
    if (!name.trim()) {
      toast.error("Le nom du modèle est obligatoire.");
      return;
    }
    setError(null);
    setProgress(null);
    setLogs([]);
    setRunning(true);
    // Ollama émet la progression couche par couche : l'agrégation par digest
    // donne un pourcentage global du téléchargement.
    const layers = new Map<string, { total: number; completed: number }>();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/admin/providers/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name.trim() }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Le téléchargement a échoué.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let evt: PullEvent;
          try {
            evt = JSON.parse(line) as PullEvent;
          } catch {
            continue;
          }
          if (evt.type === "error") {
            setError(evt.message ?? "Le téléchargement a échoué.");
            return;
          }
          if (evt.type === "success") {
            toast.success(`Modèle « ${name.trim()} » téléchargé.`);
            setName("");
            onDone();
            onClose();
            return;
          }
          if (evt.type === "log") {
            if (evt.message) setLogs((prev) => [...prev.slice(-199), evt.message!]);
          } else if (evt.type === "progress") {
            if (evt.digest) {
              layers.set(evt.digest, {
                total: evt.total ?? 0,
                completed: evt.completed ?? 0,
              });
            }
            let downloaded = 0;
            let total = 0;
            for (const layer of layers.values()) {
              downloaded += layer.completed;
              total += layer.total;
            }
            setProgress({ downloaded, total });
          }
        }
      }
      // Flux terminé sans évènement success ni error (déconnexion réseau).
      setError("Le téléchargement a été interrompu : le flux d'Ollama s'est arrêté prématurément.");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        toast.info("Téléchargement annulé.");
        return;
      }
      setError(e instanceof Error ? e.message : "Le téléchargement a échoué.");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Télécharger un modèle local</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="pull-model-name">Nom du modèle</Label>
            <Input
              id="pull-model-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ministral-3:3b"
              className="mono"
              disabled={running}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Copiez le nom exact depuis la bibliothèque Ollama (ollama.com),
              ex. « ministral-3:3b ». Le modèle est téléchargé sur le serveur
              d’inférence local : la durée dépend de sa taille.
            </p>
          </div>

          {running ? (
            <div className="space-y-2 rounded-2xl border border-border bg-background p-4">
              {percent !== null && progress ? (
                <>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-border"
                    role="progressbar"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full bg-jaune transition-all"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <p className="mono text-xs text-muted-foreground">
                    {(progress.downloaded / 1024 ** 3).toFixed(1)} /{" "}
                    {(progress.total / 1024 ** 3).toFixed(1)} Go ({percent} %)
                  </p>
                </>
              ) : (
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-border"
                  role="progressbar"
                  aria-label="Téléchargement en cours"
                >
                  <div className="h-full w-full rounded-full bg-jaune opacity-60 animate-pulse" />
                </div>
              )}
            </div>
          ) : null}

          {logs.length > 0 ? (
            <div
              ref={logsRef}
              className="max-h-40 overflow-y-auto rounded-2xl bg-charbon p-3 mono text-xs leading-relaxed text-blanc"
            >
              {logs.map((line, index) => (
                <div key={index}>{line}</div>
              ))}
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {running ? "Annuler le téléchargement" : "Annuler"}
          </Button>
          {!running ? (
            <Button
              onClick={() => void handlePull()}
              className="bg-jaune font-semibold text-charbon hover:bg-jaune/90"
            >
              Valider
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
