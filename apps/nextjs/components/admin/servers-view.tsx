"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HardDrive, Bot, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/parus/status";
import { ConfirmNameDialog } from "@/components/parus/confirm-name-dialog";
import { formatDate } from "@/lib/format";
import type { LocalServer } from "@/types/db";
import {
  addProprietaryModel,
  deleteProprietaryModel,
  deleteServer,
  testServer,
  updateProprietaryModel,
  upsertServer,
} from "@/app/(app)/admin/actions";

const KINDS = { s3: "Serveurs de fichiers S3", llm: "Serveurs d’exécution LLM" } as const;

export function ServersView({
  servers,
  proprietaryModels,
  ollamaModels,
}: {
  servers: LocalServer[];
  proprietaryModels: {
    id: string;
    provider: string;
    model: string;
    created_at: string;
  }[];
  ollamaModels: { name: string; size: number }[];
}) {
  const [editing, setEditing] = useState<LocalServer | "new" | null>(null);
  const [modelEditing, setModelEditing] = useState<{
    id: string;
    model: string;
  } | "new" | null>(null);
  const router = useRouter();

  async function handleTest(server: LocalServer) {
    toast.info(`Test de ${server.name}…`);
    const result = await testServer(server.id);
    if (result.status === "connected") {
      toast.success(`${server.name} est joignable.`);
    } else {
      toast.error(`${server.name} est injoignable : ${result.error ?? "erreur inconnue"}`, {
        duration: 9000,
      });
    }
    router.refresh();
  }

  return (
    <div className="space-y-10">
      {/* Tableaux par type de serveur */}
      {(["s3", "llm"] as const).map((kind) => {
        const rows = servers.filter((s) => s.kind === kind);
        return (
          <section key={kind}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-display text-lg">
                {kind === "s3" ? (
                  <HardDrive className="h-5 w-5 text-olive" strokeWidth={1.6} />
                ) : (
                  <Bot className="h-5 w-5 text-olive" strokeWidth={1.6} />
                )}
                {KINDS[kind]}
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing("new")}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.8} /> Ajouter un serveur
              </Button>
            </div>
            <div className="overflow-hidden rounded-3xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nom</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Dernier test</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        Aucun serveur enregistré.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((server) => (
                      <TableRow key={server.id}>
                        <TableCell className="font-medium">{server.name}</TableCell>
                        <TableCell className="mono text-xs">
                          {server.server_type}
                        </TableCell>
                        <TableCell className="mono text-xs text-muted-foreground">
                          {server.url}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            tone={server.status === "connected" ? "active" : "inactive"}
                            label={
                              server.status === "connected"
                                ? "Connecté"
                                : "Déconnecté"
                            }
                          />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(server.last_tested_at)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Tester ${server.name}`}
                              onClick={() => void handleTest(server)}
                            >
                              <RefreshCw className="h-4 w-4" strokeWidth={1.6} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Modifier ${server.name}`}
                              onClick={() => setEditing(server)}
                            >
                              <Pencil className="h-4 w-4" strokeWidth={1.6} />
                            </Button>
                            <ConfirmNameDialog
                              title="Supprimer ce serveur ?"
                              description={`Le serveur « ${server.name} » sera retiré de la liste (aucune donnée supprimée).`}
                              expectedName={server.name}
                              trigger={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="hover:text-destructive"
                                  aria-label={`Supprimer ${server.name}`}
                                >
                                  <Trash2 className="h-4 w-4" strokeWidth={1.6} />
                                </Button>
                              }
                              action={() => deleteServer(server.id)}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        );
      })}

      {/* Modèles open source (Ollama local) */}
      <section>
        <h2 className="mb-1 flex items-center gap-2 font-display text-lg">
          <Bot className="h-5 w-5 text-olive" strokeWidth={1.6} />
          Modèles open source (Ollama)
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Modèles servis par le serveur d’inférence local. Le téléchargement et
          la suppression se pilotent côté serveur Ollama
          (<code className="mono text-xs">cd apps/ollama && sh run.sh start</code>).
        </p>
        <div className="overflow-hidden rounded-3xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modèle</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Taille</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ollamaModels.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Ollama est injoignable ou aucun modèle n’est téléchargé.
                  </TableCell>
                </TableRow>
              ) : (
                ollamaModels.map((model) => (
                  <TableRow key={model.name}>
                    <TableCell className="mono font-medium">{model.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      Hugging Face (via Ollama)
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="mono text-[10px]">
                        Local
                      </Badge>
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
      </section>

      {/* Modèles propriétaires (clés API chiffrées) */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg">
              <Bot className="h-5 w-5 text-olive" strokeWidth={1.6} />
              Modèles payants
            </h2>
            <p className="text-sm text-muted-foreground">
              Clés API chiffrées côté serveur, masquées dans l’interface,
              jamais renvoyées au navigateur.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setModelEditing("new")}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} /> Ajouter un modèle
          </Button>
        </div>
        <div className="overflow-hidden rounded-3xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fournisseur</TableHead>
                <TableHead>Modèle</TableHead>
                <TableHead>Clé API</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {proprietaryModels.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Aucun modèle propriétaire configuré. Ajoutez-en un avec sa
                    clé API pour le proposer à la création d’agents.
                  </TableCell>
                </TableRow>
              ) : (
                proprietaryModels.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell className="font-medium capitalize">
                      {model.provider}
                    </TableCell>
                    <TableCell className="mono text-sm">{model.model}</TableCell>
                    <TableCell className="mono text-xs text-muted-foreground">
                      [Masquée]
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Modifier ${model.model}`}
                          onClick={() =>
                            setModelEditing({ id: model.id, model: model.model })
                          }
                        >
                          <Pencil className="h-4 w-4" strokeWidth={1.6} />
                        </Button>
                        <ConfirmNameDialog
                          title="Supprimer ce modèle ?"
                          description={`Le modèle « ${model.model} » et sa clé chiffrée seront supprimés.`}
                          expectedName={model.model}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="hover:text-destructive"
                              aria-label={`Supprimer ${model.model}`}
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={1.6} />
                            </Button>
                          }
                          action={() => deleteProprietaryModel(model.id)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Dialog serveur */}
      <ServerDialog
        key={editing === "new" ? "new" : (editing as LocalServer | null)?.id ?? "closed"}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => router.refresh()}
      />

      {/* Dialog modèle propriétaire */}
      <ModelDialog
        key={
          modelEditing === "new"
            ? "new"
            : modelEditing
              ? modelEditing.id
              : "closed"
        }
        editing={modelEditing}
        onClose={() => setModelEditing(null)}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}

function ServerDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: LocalServer | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = editing !== null && editing !== "new";
  const server = isEdit ? (editing as LocalServer) : null;
  const [kind, setKind] = useState<"s3" | "llm">(server?.kind ?? "llm");
  const [name, setName] = useState(server?.name ?? "");
  const [type, setType] = useState(server?.server_type ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [pending, setPending] = useState(false);

  async function handleSubmit() {
    if (pending) return;
    if (!name.trim() || !type.trim() || !url.trim()) {
      toast.error("Tous les champs sont obligatoires.");
      return;
    }
    setPending(true);
    try {
      const result = await upsertServer({
        id: server?.id,
        kind,
        name,
        server_type: type,
        url,
      });
      if (result.ok) {
        toast.success(server ? "Serveur mis à jour." : "Serveur enregistré.");
        // Enregistrement sans test réussi : statut « déconnecté » jusqu’au test.
        toast.info("Lancez un test pour valider la connexion.");
        onClose();
        onSaved();
      } else {
        toast.error(result.error ?? "L’enregistrement a échoué.");
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
            {server ? `Modifier ${server.name}` : "Ajouter un serveur"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label>Type de serveur</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as "s3" | "llm")}
              disabled={isEdit}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="s3">Serveur de fichiers S3</SelectItem>
                <SelectItem value="llm">Serveur d’exécution LLM</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="server-name">Nom</Label>
            <Input
              id="server-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mon S3 / Mon LLM"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="server-type">Technologie</Label>
            <Input
              id="server-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="rustfs, minio, ollama, llamacpp…"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="server-url">URL</Label>
            <Input
              id="server-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://…"
              className="mono"
            />
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
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModelDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: { id: string; model: string } | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = editing === "new";
  const current = editing !== null && editing !== "new" ? editing : null;
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState(current?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit() {
    if (pending) return;
    if (!model.trim() || (isNew && !apiKey.trim())) {
      toast.error("Le modèle et la clé API sont obligatoires.");
      return;
    }
    setPending(true);
    try {
      const result = isNew
        ? await addProprietaryModel({
            provider: provider as "openai",
            model,
            apiKey,
          })
        : current
          ? await updateProprietaryModel(current.id, { model, apiKey })
          : { ok: false, error: "Modèle introuvable." };
      if (result.ok) {
        toast.success(isNew ? "Modèle ajouté." : "Modèle mis à jour.");
        onClose();
        onSaved();
      } else {
        toast.error(result.error ?? "L’enregistrement a échoué.");
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
            {isNew ? "Ajouter un modèle payant" : `Modifier ${current?.model}`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {isNew ? (
            <div className="grid gap-2">
              <Label>Fournisseur</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="mistral">Mistral</SelectItem>
                  <SelectItem value="custom">Autre</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="model-name">Modèle</Label>
            <Input
              id="model-name"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-5.3, sonnet-4.5…"
              className="mono"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="model-key">
              Clé API {current ? "(laisser vide pour conserver l’actuelle)" : ""}
            </Label>
            <Input
              id="model-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
            />
            <p className="text-xs text-muted-foreground">
              Chiffrée AES-256-GCM au repos. Jamais affichée ni renvoyée.
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
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
