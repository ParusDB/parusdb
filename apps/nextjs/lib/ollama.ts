// Client Ollama (serveur d'inférence LLM local, AGENTS.md §11).
// Un seul chemin LLM <-> données : mcp-trino. Le modèle ne reçoit jamais de
// chaîne de connexion ; il reçoit des outils MCP.

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
export const DEFAULT_MODEL =
  process.env.OLLAMA_DEFAULT_MODEL ?? "gemma4:e2b";

export interface OllamaModel {
  name: string;
  size: number;
}

export async function listModels(): Promise<OllamaModel[]> {
  const res = await fetch(`${OLLAMA_URL}/api/tags`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Ollama est injoignable (HTTP ${res.status}) : vérifiez que le service tourne (cd apps/ollama && sh run.sh start).`,
    );
  }
  const data = (await res.json()) as {
    models?: { name: string; size: number }[];
  };
  return (data.models ?? []).map((m) => ({ name: m.name, size: m.size }));
}

export interface OllamaToolCall {
  function: { name: string; arguments: string | Record<string, unknown> };
}

export interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

export interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatResult {
  message: OllamaMessage;
  prompt_tokens: number;
  eval_tokens: number;
}

export async function chatOnce(params: {
  model: string;
  messages: OllamaMessage[];
  tools?: OllamaTool[];
}): Promise<ChatResult> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      tools: params.tools ?? [],
      stream: false,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Ollama /api/chat a échoué (HTTP ${res.status}) : ${text.slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as {
    message: OllamaMessage;
    prompt_eval_count?: number;
    eval_count?: number;
  };
  return {
    message: data.message,
    prompt_tokens: data.prompt_eval_count ?? 0,
    eval_tokens: data.eval_count ?? 0,
  };
}

export async function ollamaPing(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}
