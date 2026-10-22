// Types des lignes métier (schémas PostgreSQL iam / agents / chat /
// lakehouse / connectors / admin / support). Typage explicite des frontières
// (AGENTS.md §6) — les identifiants techniques restent en anglais.

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  permissions: string[];
  is_system: boolean;
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
  model_provider: "ollama" | "openai" | "anthropic" | "mistral" | "custom";
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

export interface LocalServer {
  id: string;
  kind: "s3" | "llm";
  name: string;
  server_type: string;
  url: string;
  status: "connected" | "disconnected";
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProprietaryModel {
  id: string;
  provider: "openai" | "anthropic" | "mistral" | "custom";
  model: string;
  created_at: string;
}

export interface Ticket {
  id: string;
  owner_id: string;
  subject: string;
  message: string;
  status: "open" | "closed";
  created_at: string;
  updated_at: string;
  owner?: { first_name: string | null; last_name: string | null } | null;
}
