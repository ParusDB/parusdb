// Boucle agentique : LLM (Ollama local ou fournisseur par clé API,
// function calling) -> outils MCP mcp-trino -> Trino. Porté du parcours e2e
// validé (apps/ollama/scripts/test-mcp-trino.mjs). Le modèle ne reçoit
// jamais de chaîne de connexion : uniquement les outils MCP exposés par
// mcp-trino (lecture seule).

import type {
  LlmBackend,
  NormalizedMessage,
  NormalizedTool,
} from "@/lib/llm";
import { McpClient } from "@/lib/mcp";

const MAX_STEPS = Number(process.env.PARUSDB_AGENT_MAX_STEPS ?? 8);

export interface ToolTrace {
  name: string;
  query?: string;
  ok: boolean;
}

export interface AgentRunEvent {
  type: "status" | "tool" | "tool_result";
  label?: string;
  tool?: string;
  query?: string;
  ok?: boolean;
}

export interface AgentRunResult {
  content: string;
  metadata: {
    model: string;
    duration_ms: number;
    prompt_tokens: number;
    eval_tokens: number;
    tool_calls: ToolTrace[];
    error?: string;
  };
}

// Prompt système de base : complété par le prompt système de l'agent (donnée,
// pas du code — AGENTS.md §11).
function baseSystemPrompt(): string {
  return [
    "Tu es l'assistant analytique de ParusDB, une plateforme data lakehouse.",
    "Tu réponds en français, de façon factuelle, directe et concise.",
    `La date d'aujourd'hui est le ${new Date().toISOString().slice(0, 10)}.`,
    "Tu accèdes au lakehouse uniquement via les outils MCP du serveur Trino fournis :",
    "explore d'abord les catalogues et schémas, puis les tables et leurs colonnes,",
    "ensuite écris et exécute une requête SQL via l'outil d'exécution.",
    "Le moteur est Trino. Dates relatives : utilise",
    "date_add('month', -3, current_date) ou current_date - INTERVAL '3' DAY.",
    "N'écris jamais l'unité dans la chaîne d'intervalle (INTERVAL '3 months'",
    "est rejeté par Trino) et ne réessaie pas une syntaxe qui vient d'être",
    "rejetée : change d'approche.",
    "Si une requête échoue, corrige la syntaxe et réessaie avant de répondre.",
    "Restitue enfin la réponse clairement, avec les unités.",
    "Ne révèle jamais de chaîne de connexion ni de secret d'infrastructure.",
  ].join(" ");
}

export async function runAgent(params: {
  // Identifiant du modèle tel que l'API du backend l'attend (sans préfixe
  // de fournisseur — « Mistral/mon-modele » serait rejeté en HTTP 400).
  model: string;
  // Libellé de traçabilité (metadata du message), avec le nom du
  // fournisseur pour les sources par clé API.
  modelLabel?: string;
  backend: LlmBackend;
  agentSystemPrompt: string;
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
  onEvent?: (event: AgentRunEvent) => Promise<void> | void;
}): Promise<AgentRunResult> {
  const started = Date.now();
  const emit = params.onEvent ?? (() => {});
  const toolCalls: ToolTrace[] = [];
  let promptTokens = 0;
  let evalTokens = 0;

  await emit({ type: "status", label: "Connexion au lakehouse (mcp-trino)…" });
  const mcp = new McpClient();
  await mcp.connect();
  const tools: NormalizedTool[] = (await mcp.listTools()).map((t) => ({
    name: t.name,
    description: t.description ?? "",
    parameters: t.inputSchema ?? { type: "object", properties: {} },
  }));

  const systemPrompt = [baseSystemPrompt(), params.agentSystemPrompt]
    .filter(Boolean)
    .join("\n\n");
  const messages: NormalizedMessage[] = [
    { role: "system", content: systemPrompt },
    ...params.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: params.userMessage },
  ];

  let finalAnswer: string | null = null;
  for (let step = 1; step <= MAX_STEPS; step += 1) {
    await emit({ type: "status", label: `Analyse (étape ${step})…` });
    const result = await params.backend.chat({
      model: params.model,
      messages,
      tools,
    });
    promptTokens += result.prompt_tokens;
    evalTokens += result.eval_tokens;
    messages.push({
      role: "assistant",
      content: result.content,
      ...(result.tool_calls.length ? { tool_calls: result.tool_calls } : {}),
    });

    if (result.tool_calls.length === 0) {
      finalAnswer = result.content;
      break;
    }

    for (const tc of result.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(tc.arguments) as unknown;
        if (parsed && typeof parsed === "object") {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        args = {};
      }
      const query = typeof args.query === "string" ? args.query : undefined;
      await emit({ type: "tool", tool: tc.name, query });
      const { text, isError } = await mcp.callTool(tc.name, args);
      const ok = !isError;
      toolCalls.push({ name: tc.name, query, ok });
      await emit({ type: "tool_result", tool: tc.name, ok });
      messages.push({
        role: "tool",
        content: isError
          ? `ERREUR : ${text || "(aucun détail)"}`
          : text || "(aucun résultat)",
        tool_call_id: tc.id,
        tool_name: tc.name,
      });
    }
  }

  if (finalAnswer === null) {
    finalAnswer =
      "Je n'ai pas pu produire de réponse finale dans la limite d'étapes autorisée. Reformulez la question ou ressayez.";
  }

  return {
    content: finalAnswer,
    metadata: {
      model: params.modelLabel ?? params.model,
      duration_ms: Date.now() - started,
      prompt_tokens: promptTokens,
      eval_tokens: evalTokens,
      tool_calls: toolCalls,
    },
  };
}

// Titre de conversation généré par l'IA à partir des 2 premiers échanges
// (spec §Chat). Repli : troncature du premier message utilisateur.
export async function generateConversationTitle(params: {
  model: string;
  backend: LlmBackend;
  question: string;
  answer: string;
}): Promise<string> {
  const fallback = params.question.replace(/\s+/g, " ").trim().slice(0, 48);
  try {
    const result = await params.backend.chat({
      model: params.model,
      messages: [
        {
          role: "system",
          content:
            "Tu génères des titres de conversation en français : 6 mots maximum, sans guillemets, sans ponctuation finale. Réponds uniquement par le titre.",
        },
        {
          role: "user",
          content: `Question : ${params.question.slice(0, 500)}\nRéponse : ${params.answer.slice(0, 500)}`,
        },
      ],
    });
    const title = result.content
      .replace(/^["'«»\s]+|["'«»\s]+$/g, "")
      .split("\n")[0]
      .slice(0, 60)
      .trim();
    return title || fallback;
  } catch {
    return fallback;
  }
}
