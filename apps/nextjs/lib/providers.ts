import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { listModels } from "@/lib/ollama";
import {
  createAnthropicBackend,
  createOpenAiCompatibleBackend,
  type LlmBackend,
} from "@/lib/llm";

// Fournisseurs de modèles LLM (AGENTS.md §11). Ollama (local) est embarqué par
// ParusDB ; les fournisseurs externes sont ajoutés en administration par clé
// API (chiffrée au repos). Les modèles ne sont pas stockés : ils sont
// découverts dynamiquement via l'API de listing du fournisseur. Module
// serveur uniquement (clés déchiffrées ici, jamais renvoyées au client).

export type ProviderApiKind =
  | "openai"
  | "anthropic"
  | "mistral"
  | "openai_compatible";

export const PROVIDER_API_KIND_LABELS: Record<ProviderApiKind, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  mistral: "Mistral",
  openai_compatible: "Compatible OpenAI",
};

async function fetchJson(
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `HTTP ${res.status}${text ? ` : ${text.slice(0, 200)}` : ""}`,
      );
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Découverte des modèles d'un fournisseur via son API de listing. La clé est
// validée par le même appel (erreur explicite si elle est rejetée).
export async function discoverProviderModels(params: {
  apiKind: ProviderApiKind;
  apiKey: string;
  baseUrl?: string | null;
}): Promise<string[]> {
  const { apiKind, apiKey, baseUrl } = params;
  if (apiKind === "openai_compatible" && !baseUrl) {
    throw new Error("URL de base manquante pour un fournisseur compatible OpenAI.");
  }
  const data =
    apiKind === "anthropic"
      ? await fetchJson("https://api.anthropic.com/v1/models", {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        })
      : await fetchJson(
          apiKind === "openai"
            ? "https://api.openai.com/v1/models"
            : apiKind === "mistral"
              ? "https://api.mistral.ai/v1/models"
              : `${(baseUrl ?? "").replace(/\/+$/, "")}/models`,
          { Authorization: `Bearer ${apiKey}` },
        );
  const models = (data as { data?: { id?: string }[] }).data ?? [];
  return models
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id))
    .sort();
}

// Détail d'un fournisseur pour l'administration : métadonnées + modèles
// découverts (ou l'erreur de découverte, affichée dans l'interface).
export interface ProviderDetail {
  id: string;
  name: string;
  apiKind: ProviderApiKind;
  baseUrl: string | null;
  models: string[];
  discoveryError: string | null;
  createdAt: string;
}

interface ProviderRow {
  id: string;
  name: string;
  api_kind: string;
  base_url: string | null;
  api_key_encrypted: string;
  created_at: string;
}

function isProviderApiKind(value: string): value is ProviderApiKind {
  return ["openai", "anthropic", "mistral", "openai_compatible"].includes(value);
}

export async function listProviderDetails(): Promise<ProviderDetail[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("admin")
    .from("providers")
    .select("id, name, api_kind, base_url, api_key_encrypted, created_at")
    .order("name");
  if (error) {
    throw new Error(`La lecture des fournisseurs a échoué : ${error.message}`);
  }
  const rows = (data ?? []) as unknown as ProviderRow[];
  return Promise.all(
    rows.map(async (row) => {
      const detail: ProviderDetail = {
        id: row.id,
        name: row.name,
        apiKind: isProviderApiKind(row.api_kind) ? row.api_kind : "openai_compatible",
        baseUrl: row.base_url,
        models: [],
        discoveryError: null,
        createdAt: row.created_at,
      };
      try {
        detail.models = await discoverProviderModels({
          apiKind: detail.apiKind,
          apiKey: decryptSecret(row.api_key_encrypted),
          baseUrl: row.base_url,
        });
      } catch (e) {
        detail.discoveryError =
          e instanceof Error ? e.message : "erreur inconnue";
      }
      return detail;
    }),
  );
}

// Sources de modèles pour le formulaire d'agent : Ollama (local) en tête,
// puis un fournisseur par clé API. `value` vaut 'ollama' ou l'id du
// fournisseur - c'est ce que agents.agents.model_provider stocke.
export interface ModelSource {
  value: string;
  label: string;
  models: string[];
}

export async function listModelSources(): Promise<ModelSource[]> {
  const [ollamaModels, providers] = await Promise.all([
    listModels()
      .then((m) => m.map((x) => x.name))
      .catch(() => [] as string[]),
    listProviderDetails().catch(() => [] as ProviderDetail[]),
  ]);
  return [
    { value: "ollama", label: "Ollama (local)", models: ollamaModels },
    ...providers.map((p) => ({
      value: p.id,
      label: p.name,
      models: p.models,
    })),
  ];
}

// Libellé lisible d'une source de modèle (affichage agents, chat).
export function providerLabel(
  value: string | null | undefined,
  labels: Map<string, string>,
): string {
  if (!value || value === "ollama") return "Ollama (local)";
  return labels.get(value) ?? "Source supprimée";
}

// Map id → nom des fournisseurs, pour les affichages. PostgREST ne résout
// pas un nom de fonction non qualifié hors du schéma par défaut (`public`) :
// l'appel doit cibler le schéma `admin` (en-tête Content-Profile), sinon
// PGRST202 « Could not find the function public.list_providers ».
export async function fetchProviderLabels(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .schema("admin")
    .rpc("list_providers");
  if (error) {
    throw new Error(`La lecture des fournisseurs a échoué : ${error.message}`);
  }
  return new Map(
    ((data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );
}

// Backend d'exécution d'un fournisseur par clé API (conversation d'un agent).
// La clé est déchiffrée en mémoire côté serveur, jamais loggée ni renvoyée.
export async function resolveProviderBackend(
  providerId: string,
): Promise<{ name: string; backend: LlmBackend }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("admin")
    .from("providers")
    .select("id, name, api_kind, base_url, api_key_encrypted")
    .eq("id", providerId)
    .maybeSingle();
  if (error) {
    throw new Error(`La lecture du fournisseur a échoué : ${error.message}`);
  }
  if (!data) {
    throw new Error(
      "La source du modèle de cet agent n’existe plus (fournisseur supprimé en administration). Modifiez l’agent pour choisir une autre source.",
    );
  }
  const row = data as {
    name: string;
    api_kind: string;
    base_url: string | null;
    api_key_encrypted: string;
  };
  const apiKey = decryptSecret(row.api_key_encrypted);
  const apiKind = isProviderApiKind(row.api_kind)
    ? row.api_kind
    : "openai_compatible";
  if (apiKind === "anthropic") {
    return {
      name: row.name,
      backend: createAnthropicBackend({ apiKey, label: row.name }),
    };
  }
  const baseUrl =
    apiKind === "openai"
      ? "https://api.openai.com/v1"
      : apiKind === "mistral"
        ? "https://api.mistral.ai/v1"
        : row.base_url ?? "";
  if (!baseUrl) {
    throw new Error(
      `Le fournisseur « ${row.name} » n’a pas d’URL de base configurée.`,
    );
  }
  return {
    name: row.name,
    backend: createOpenAiCompatibleBackend({ baseUrl, apiKey, label: row.name }),
  };
}
