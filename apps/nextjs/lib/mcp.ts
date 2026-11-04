// Client MCP (Streamable HTTP) vers mcp-trino - porté du parcours e2e validé
// (apps/ollama/scripts/test-mcp-trino.mjs, AGENTS.md §11). Lecture seule : le
// LLM explore le lakehouse et exécute du SQL uniquement via ces outils.

import type { OllamaTool } from "@/lib/ollama";

const MCP_ENDPOINT = process.env.MCP_TRINO_URL ?? "http://localhost:8185/mcp";

interface JsonRpcResponse {
  jsonrpc: string;
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolResult {
  text: string;
  isError: boolean;
}

export class McpClient {
  private sessionId: string | null = null;
  private rpcId = 0;

  private async call(
    method: string,
    params?: unknown,
  ): Promise<JsonRpcResponse> {
    const id = ++this.rpcId;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    const res = await fetch(MCP_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      cache: "no-store",
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    const body = await res.text();
    if (!res.ok) {
      throw new Error(
        `MCP ${method} → HTTP ${res.status} : ${body.slice(0, 300)}`,
      );
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      for (const line of body.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          const j = JSON.parse(line.slice(5).trim()) as JsonRpcResponse;
          if (j.id === id) return j;
        } catch {
          // évènement non JSON ignoré
        }
      }
      throw new Error(`MCP ${method} : pas de réponse JSON-RPC.`);
    }
    if (!body.trim()) {
      throw new Error(`MCP ${method} : réponse vide.`);
    }
    return JSON.parse(body) as JsonRpcResponse;
  }

  private async notify(method: string): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    const res = await fetch(MCP_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method }),
      cache: "no-store",
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(`MCP notify ${method} → HTTP ${res.status}`);
    }
  }

  async connect(): Promise<void> {
    const init = await this.call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "parusdb-app", version: "0.1.0" },
    });
    if (init.error) {
      throw new Error(`MCP initialize → ${init.error.message}`);
    }
    await this.notify("notifications/initialized");
  }

  async listTools(): Promise<McpToolInfo[]> {
    const res = await this.call("tools/list", {});
    if (res.error) throw new Error(`MCP tools/list → ${res.error.message}`);
    const result = res.result as { tools?: McpToolInfo[] } | undefined;
    return result?.tools ?? [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const res = await this.call("tools/call", { name, arguments: args });
    if (res.error) throw new Error(`MCP tools/call → ${res.error.message}`);
    const result = res.result as
      | { content?: { type: string; text?: string }[]; isError?: boolean }
      | undefined;
    const text = (result?.content ?? [])
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("\n");
    return { text, isError: result?.isError === true };
  }
}

export function toOllamaTools(tools: McpToolInfo[]): OllamaTool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.inputSchema ?? { type: "object", properties: {} },
    },
  }));
}

export async function mcpPing(): Promise<boolean> {
  try {
    const client = new McpClient();
    await client.connect();
    await client.listTools();
    return true;
  } catch {
    return false;
  }
}
