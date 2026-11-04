// Backends de chat LLM normalisés pour la boucle agentique (AGENTS.md §11).
// Ollama (local, embarqué), API compatible OpenAI (OpenAI, Mistral, autre)
// et Anthropic : chaque backend reçoit le même historique normalisé et les
// mêmes outils, et restitue un tour de chat normalisé. Le modèle ne reçoit
// jamais de chaîne de connexion : uniquement les outils MCP exposés par
// mcp-trino. Les clés API vivent côté serveur (chiffrées, jamais loggées).

import {
  chatOnce,
  type OllamaMessage,
  type OllamaTool,
} from "@/lib/ollama";

export interface NormalizedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface NormalizedToolCall {
  id: string;
  name: string;
  // Arguments sérialisés JSON : le modèle peut renvoyer un objet ou une
  // chaîne selon l'API, on normalise toujours en chaîne.
  arguments: string;
}

export interface NormalizedMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: NormalizedToolCall[];
  tool_call_id?: string;
  tool_name?: string;
}

export interface NormalizedChatResult {
  content: string;
  tool_calls: NormalizedToolCall[];
  prompt_tokens: number;
  eval_tokens: number;
}

export interface LlmBackend {
  chat(params: {
    model: string;
    messages: NormalizedMessage[];
    tools?: NormalizedTool[];
  }): Promise<NormalizedChatResult>;
}

function parseArguments(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") return JSON.stringify(raw);
  return "{}";
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Arguments non parsables : objet vide, Ollama n'accepte pas une
    // chaîne à cet endroit.
  }
  return {};
}

// Certains modèles de raisonnement (ex. zai-glm via Mistral) renvoient
// `message.content` en tableau de blocs ({type:"thinking"|"text"|…})
// au lieu d'une chaîne : on n'en retient que le texte.
function normalizeContent(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .filter(
        (p): p is { type?: string; text?: string } =>
          Boolean(p) &&
          typeof p === "object" &&
          (p as { type?: string }).type === "text",
      )
      .map((p) => p.text ?? "")
      .join("");
  }
  return "";
}

// ---------------------------------------------------------------------------
// Ollama (serveur d'inférence local embarqué)
// ---------------------------------------------------------------------------

export function createOllamaBackend(): LlmBackend {
  return {
    async chat({ model, messages, tools }) {
      const ollamaMessages: OllamaMessage[] = messages.map((m) => {
        if (m.role === "tool") {
          return { role: "tool", content: m.content, tool_name: m.tool_name };
        }
        if (m.role === "assistant" && m.tool_calls?.length) {
          return {
            role: "assistant",
            content: m.content,
            tool_calls: m.tool_calls.map((tc) => ({
              function: {
                name: tc.name,
                // Ollama rejette les arguments sérialisés en chaîne au
                // renvoi d'un message assistant (« Value looks like object,
                // but can't find closing '}' symbol », HTTP 400) : il faut
                // restituer l'objet.
                arguments: parseToolArguments(tc.arguments),
              },
            })),
          };
        }
        return { role: m.role, content: m.content };
      });
      const ollamaTools: OllamaTool[] | undefined = tools?.length
        ? tools.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }))
        : undefined;
      const result = await chatOnce({
        model,
        messages: ollamaMessages,
        tools: ollamaTools,
      });
      const toolCalls = (result.message.tool_calls ?? []).map((tc, i) => ({
        id: tc.function?.name
          ? `${tc.function.name}-${i}`
          : `call-${i}`,
        name: tc.function?.name ?? "",
        arguments: parseArguments(tc.function?.arguments),
      }));
      return {
        content: result.message.content ?? "",
        tool_calls: toolCalls.filter((tc) => tc.name),
        prompt_tokens: result.prompt_tokens,
        eval_tokens: result.eval_tokens,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// API compatible OpenAI (OpenAI, Mistral, endpoints personnalisés)
// ---------------------------------------------------------------------------

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

export function createOpenAiCompatibleBackend(params: {
  baseUrl: string;
  apiKey: string;
  label: string;
}): LlmBackend {
  const url = `${params.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    async chat({ model, messages, tools }) {
      const body = {
        model,
        messages: messages.map((m) => {
          if (m.role === "tool") {
            return {
              role: "tool" as const,
              tool_call_id: m.tool_call_id,
              content: m.content,
            };
          }
          if (m.role === "assistant" && m.tool_calls?.length) {
            return {
              role: "assistant" as const,
              content: m.content || null,
              tool_calls: m.tool_calls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.arguments },
              })),
            };
          }
          return { role: m.role, content: m.content };
        }),
        ...(tools?.length
          ? {
              tools: tools.map((t) => ({
                type: "function" as const,
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                },
              })),
            }
          : {}),
      };
      const data = (await postJson(url, params, body)) as {
        choices?: {
          message?: {
            content?: string | null;
            tool_calls?: OpenAiToolCall[];
          };
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const message = data.choices?.[0]?.message;
      const toolCalls = (message?.tool_calls ?? []).map((tc, i) => ({
        id: tc.id ?? `call-${i}`,
        name: tc.function?.name ?? "",
        arguments: parseArguments(tc.function?.arguments),
      }));
      return {
        content: normalizeContent(message?.content),
        tool_calls: toolCalls.filter((tc) => tc.name),
        prompt_tokens: data.usage?.prompt_tokens ?? 0,
        eval_tokens: data.usage?.completion_tokens ?? 0,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Anthropic (API Messages)
// ---------------------------------------------------------------------------

export function createAnthropicBackend(params: {
  apiKey: string;
  label: string;
}): LlmBackend {
  const url = "https://api.anthropic.com/v1/messages";
  return {
    async chat({ model, messages, tools }) {
      const system = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");
      const rest = messages.filter((m) => m.role !== "system");
      const body = {
        model,
        max_tokens: 4096,
        ...(system ? { system } : {}),
        messages: rest.map((m) => {
          if (m.role === "tool") {
            return {
              role: "user" as const,
              content: [
                {
                  type: "tool_result" as const,
                  tool_use_id: m.tool_call_id,
                  content: m.content,
                },
              ],
            };
          }
          if (m.role === "assistant" && m.tool_calls?.length) {
            const content: Record<string, unknown>[] = [];
            if (m.content) {
              content.push({ type: "text", text: m.content });
            }
            for (const tc of m.tool_calls) {
              let input: Record<string, unknown> = {};
              try {
                input = JSON.parse(tc.arguments) as Record<string, unknown>;
              } catch {
                input = {};
              }
              content.push({
                type: "tool_use",
                id: tc.id,
                name: tc.name,
                input,
              });
            }
            return { role: "assistant" as const, content };
          }
          return { role: m.role, content: m.content };
        }),
        ...(tools?.length
          ? {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
              })),
            }
          : {}),
      };
      const data = (await postJson(url, params, body, {
        "anthropic-version": "2023-06-01",
        "x-api-key": params.apiKey,
      })) as {
        content?: { type?: string; text?: string; id?: string; name?: string; input?: unknown }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const blocks = data.content ?? [];
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n");
      const toolCalls = blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          id: b.id ?? "",
          name: b.name ?? "",
          arguments: JSON.stringify(b.input ?? {}),
        }));
      return {
        content: text,
        tool_calls: toolCalls.filter((tc) => tc.name),
        prompt_tokens: data.usage?.input_tokens ?? 0,
        eval_tokens: data.usage?.output_tokens ?? 0,
      };
    },
  };
}

// ---------------------------------------------------------------------------

async function postJson(
  url: string,
  provider: { apiKey: string; label: string },
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<unknown> {
  const controller = new AbortController();
  // Un tour agentique peut être long (génération + outils) : timeout large.
  const timeout = setTimeout(() => controller.abort(), 300_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `${provider.label} a répondu HTTP ${res.status}${text ? ` : ${text.slice(0, 300)}` : ""}`,
      );
    }
    return await res.json();
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(
        `${provider.label} n'a pas répondu dans le délai imparti (5 min).`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
