import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOllamaBackend,
  createOpenAiCompatibleBackend,
} from "@/lib/llm";

// Backends LLM normalisés (lib/llm.ts, AGENTS.md §11) : la normalisation est
// le contrat commun des fournisseurs - arguments d'outils, blocs texte des
// modèles de raisonnement (tableau {type:"thinking"|"text"}), messages tool.

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
vi.stubGlobal("fetch", fetchMock);
afterEach(() => {
  fetchMock.mockReset();
});

describe("createOllamaBackend", () => {
  it("restitue les arguments d'outils en chaîne sérialisée et génère les ids", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        message: {
          role: "assistant",
          content: "réponse",
          tool_calls: [
            {
              function: {
                name: "execute_sql",
                // Ollama renvoie un objet, la normale est une chaîne.
                arguments: { sql: "select 1" },
              },
            },
          ],
        },
        prompt_eval_count: 5,
        eval_count: 7,
      }),
    );
    const result = await createOllamaBackend().chat({
      model: "ministral-3:3b",
      messages: [{ role: "user", content: "question" }],
    });
    expect(result.content).toBe("réponse");
    expect(result.prompt_tokens).toBe(5);
    expect(result.eval_tokens).toBe(7);
    expect(result.tool_calls).toEqual([
      {
        id: "execute_sql-0",
        name: "execute_sql",
        arguments: '{"sql":"select 1"}',
      },
    ]);
    // Arguments valides passés en chaîne reviennent identiques.
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.stream).toBe(false);
  });
});

describe("createOpenAiCompatibleBackend", () => {
  it("ne retient que les blocs texte d'un contenu en tableau (modèles de raisonnement)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [
          {
            message: {
              content: [
                { type: "thinking", text: "je réfléchis" },
                { type: "text", text: "visible " },
                { type: "text", text: "au user" },
              ],
              tool_calls: [],
            },
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    );
    const result = await createOpenAiCompatibleBackend({
      baseUrl: "http://localhost:1234/v1",
      apiKey: "cle",
      label: "Test",
    }).chat({
      model: "modele",
      messages: [{ role: "user", content: "q" }],
    });
    expect(result.content).toBe("visible au user");
    expect(result.tool_calls).toEqual([]);
  });

  it("conserver les ids d'appels d'outils exigés par l'API OpenAI", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_abc",
                  function: { name: "tool_x", arguments: '{"a":1}' },
                },
              ],
            },
          },
        ],
        usage: {},
      }),
    );
    const result = await createOpenAiCompatibleBackend({
      baseUrl: "https://api.exemple.com/v1/",
      apiKey: "cle",
      label: "Test",
    }).chat({
      model: "modele",
      messages: [{ role: "user", content: "q" }],
      tools: [
        {
          name: "tool_x",
          description: "outil",
          parameters: { type: "object" },
        },
      ],
    });
    expect(result.tool_calls).toEqual([
      { id: "call_abc", name: "tool_x", arguments: '{"a":1}' },
    ]);
    // Le renvoi d'un assistant porteur d'appels d'outils repart avec l'id
    // et les arguments chaînes (exigence OpenAI/Anthropic).
    const secondCall = fetchMock.mock.calls[0];
    expect(secondCall[0]).toBe("https://api.exemple.com/v1/chat/completions");
  });

  it("traduit un message tool historique au format OpenAI", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: "ok" } }], usage: {} }),
    );
    await createOpenAiCompatibleBackend({
      baseUrl: "http://localhost/v1",
      apiKey: "cle",
      label: "Test",
    }).chat({
      model: "m",
      messages: [
        {
          role: "tool",
          content: "résultat",
          tool_call_id: "call_abc",
          tool_name: "tool_x",
        },
      ],
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.messages[0]).toEqual({
      role: "tool",
      tool_call_id: "call_abc",
      content: "résultat",
    });
  });
});

describe("Ollama validateModelName", async () => {
  const { validateModelName } = await import("@/lib/ollama");
  it("accepte le registre et refuse les injections", () => {
    expect(validateModelName("ministral-3:3b")).toBe("ministral-3:3b");
    expect(validateModelName(" qwen/qwen3:8b ")).toBe("qwen/qwen3:8b");
    expect(validateModelName("mon_modele.dev")).toBe("mon_modele.dev");
    expect(validateModelName("")).toBeNull();
    expect(validateModelName("esp ace")).toBeNull();
    expect(validateModelName("a".repeat(201))).toBeNull();
    expect(validateModelName("$(rm -rf)")).toBeNull();
  });
});
