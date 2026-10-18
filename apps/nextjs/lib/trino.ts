// Client Trino (moteur SQL unique du lakehouse, AGENTS.md §10) via l'API HTTP
// /v1/statement. Aucune chaîne de connexion côté navigateur : tout passe par
// le serveur Next.js.

export interface TrinoColumn {
  name: string;
  type: string;
}

export interface TrinoQueryResult {
  columns: TrinoColumn[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
}

const TRINO_URL = process.env.TRINO_URL ?? "http://localhost:8080";
const TRINO_USER = process.env.TRINO_USER ?? "parus-app";
const MAX_ROWS = 1000;

interface TrinoStatementResponse {
  id: string;
  columns?: { name: string; type: string }[];
  data?: unknown[][];
  nextUri?: string;
  error?: { message: string; errorCode?: { name: string } };
  stats?: { state: string; elapsedTimeMillis: number };
}

async function trinoFetch(
  url: string,
  body?: string,
): Promise<TrinoStatementResponse> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "X-Trino-User": TRINO_USER,
      "X-Trino-Source": "parusdb-app",
      "Content-Type": "text/plain",
    },
    body,
    cache: "no-store",
  });
  const text = await res.text();
  let json: TrinoStatementResponse | null = null;
  try {
    json = text ? (JSON.parse(text) as TrinoStatementResponse) : null;
  } catch {
    // réponse non JSON (ex. erreur du serveur)
  }
  if (!res.ok) {
    const message =
      json?.error?.message ??
      (text ? text.slice(0, 400) : `Trino a répondu HTTP ${res.status}`);
    throw new Error(`Trino : ${message}`);
  }
  if (!json) {
    throw new Error("Trino : réponse illisible (corps non JSON).");
  }
  if (json.error) {
    throw new Error(
      `Trino : ${json.error.message}${
        json.error.errorCode?.name ? ` (${json.error.errorCode.name})` : ""
      }`,
    );
  }
  return json;
}

// Exécute une requête et agrège les pages de résultats (max MAX_ROWS lignes).
export async function trinoQuery(sql: string): Promise<TrinoQueryResult> {
  const started = Date.now();
  let current = await trinoFetch(`${TRINO_URL}/v1/statement`, sql);
  const columns: TrinoColumn[] = (current.columns ?? []).map((c) => ({
    name: c.name,
    type: c.type,
  }));
  const rows: unknown[][] = [];
  let nextUri = current.nextUri;
  let guard = 0;
  while (nextUri && rows.length < MAX_ROWS && guard < 200) {
    current = await trinoFetch(nextUri);
    if (current.data) rows.push(...current.data);
    nextUri = current.nextUri;
    guard += 1;
  }
  return {
    columns,
    rows,
    rowCount: rows.length,
    durationMs: Date.now() - started,
  };
}

// Vérifie que Trino répond (bouton « Test » des serveurs locaux).
export async function trinoPing(): Promise<boolean> {
  try {
    const res = await fetch(`${TRINO_URL}/v1/info`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
