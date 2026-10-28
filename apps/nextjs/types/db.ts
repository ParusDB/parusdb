// Types des lignes métier (schémas PostgreSQL iam / agents / chat /
// lakehouse / connectors / admin). Typage explicite des frontières
// (AGENTS.md §6) — les identifiants techniques restent en anglais.

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

// Grant RBAC : privilèges hiérarchiques (manage ⊇ write ⊇ read) d'un rôle sur
// une ressource (catalogue, agent, pipeline) — docs/functional/rbac_refonte.md.
export interface Grant {
  role_id: string;
  resource_type: "catalog" | "agent" | "pipeline";
  resource_id: string;
  privileges: ("read" | "write" | "manage")[];
  created_at?: string;
  updated_at?: string;
}

// Utilisateur applicatif (compte service pour un outil data : dbt, Power BI,
// Airbyte…) : miroir applicatif d'un principal Polaris. Le clientSecret
// n'est jamais stocké côté applicatif.
export interface AppUser {
  id: string;
  name: string;
  note: string | null;
  role_id: string;
  polaris_client_id: string;
  credentials_rotated_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  // Rôle propriétaire : le rôle actif qui a créé l'agent (RBAC refonte) ;
  // owner_id reste la traçabilité « créé par ».
  owner_role_id: string | null;
  // 'ollama' (serveur local embarqué) ou l'id d'un fournisseur externe
  // (admin.providers, cf. LlmProvider).
  model_provider: string;
  model_id: string;
  system_prompt: string;
  created_at: string;
  updated_at: string;
}

export interface AgentSource {
  agent_id: string;
  source_type: "catalog";
  source_name: string;
}

export interface Conversation {
  id: string;
  owner_id: string;
  agent_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  agent?: Pick<Agent, "id" | "name" | "model_id" | "model_provider">;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CatalogEntry {
  catalog_name: string;
  description: string | null;
  created_by: string | null;
  // Rôle propriétaire : le rôle actif qui a créé le catalogue (RBAC
  // refonte) ; created_by reste la traçabilité « créé par ».
  owner_role_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface QueryHistoryEntry {
  id: string;
  user_id: string;
  catalog_name: string;
  query: string;
  status: "success" | "error";
  duration_ms: number | null;
  row_count: number | null;
  error: string | null;
  created_at: string;
}

export interface Pipeline {
  id: string;
  owner_id: string;
  name: string;
  source_type: string;
  source_config: Record<string, unknown>;
  credentials_encrypted: string | null;
  selected_tables: string[];
  write_mode: "incremental" | "replace";
  cron: string;
  destination_catalog: string;
  destination_schema: string | null;
  status: "active" | "inactive" | "error";
  last_run_at: string | null;
  // Rôle propriétaire : le rôle actif qui a créé le pipeline (RBAC
  // refonte) ; owner_id reste la traçabilité « créé par ».
  owner_role_id: string | null;
  created_at: string;
  updated_at: string;
  owner?: { first_name: string | null; last_name: string | null } | null;
}

export interface PipelineRun {
  id: string;
  pipeline_id: string;
  status: "queued" | "running" | "success" | "error";
  trigger: "creation" | "manual" | "schedule";
  message: string | null;
  rows_loaded: number | null;
  started_at: string;
  finished_at: string | null;
}

// Fournisseur externe de modèles LLM (clé API chiffrée, jamais renvoyée au
// client). Ollama (local) est embarqué par ParusDB et n'a pas de ligne.
export interface LlmProvider {
  id: string;
  name: string;
  api_kind: "openai" | "anthropic" | "mistral" | "openai_compatible";
  base_url: string | null;
  created_at: string;
  updated_at: string;
}
