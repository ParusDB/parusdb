#!/usr/bin/env node
/**
 * Test e2e de la brique Chat IA de ParusDB (AGENTS.md §11).
 *
 * Parcours validé : une question métier posée en français → le LLM servi par
 * Ollama (function calling) explore le lakehouse et exécute du SQL via les
 * outils MCP de mcp-trino → il restitue la réponse dans le chat.
 *
 * Exemple : « Quel est mon chiffre d'affaire sur 3 mois ? »
 *
 * Prérequis :
 *   - apps/ollama démarré, modèle OLLAMA_DEFAULT_MODEL téléchargé ;
 *   - apps/mcp-trino démarré (adossé à apps/trino, lui-même adossé à Polaris) ;
 *   - Node.js >= 18 (aucune dépendance npm, fetch natif).
 *
 * Usage :
 *   node scripts/test-mcp-trino.mjs
 *   node scripts/test-mcp-trino.mjs --question "..." --model ministral-3:3b --think
 *
 * Données de test : le script recrée (idempotent) la table `${CATALOG}.sales.orders`
 * dans le lakehouse et y insère des commandes sur les 6 derniers mois. Le total
 * mensuel est constant, donc toute fenêtre de 3 mois donne le même chiffre
 * d'affaires attendu — le script vérifie que le LLM le restitue.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Arguments et configuration
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { question: null, model: null, think: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--question") out.question = argv[++i];
    else if (argv[i] === "--model") out.model = argv[++i];
    else if (argv[i] === "--think") out.think = true;
    else if (argv[i] === "-h" || argv[i] === "--help") out.help = true;
    else { console.error(`Option inconnue : ${argv[i]}`); process.exit(2); }
  }
  return out;
}

function readEnv(file) {
  const env = {};
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  } catch { /* fichier absent : valeurs par défaut */ }
  return env;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log("Usage : node scripts/test-mcp-trino.mjs [--question \"...\"] [--model ministral-3:3b] [--think]");
  process.exit(0);
}

const ollamaEnv = readEnv(path.join(here, "..", ".env"));
const mcpEnv = readEnv(path.join(here, "..", "..", "mcp-trino", ".env"));
const trinoEnv = readEnv(path.join(here, "..", "..", "trino", ".env"));

const OLLAMA_BASE = `http://localhost:${ollamaEnv.OLLAMA_PORT || "11434"}`;
const MCP_ENDPOINT = `http://localhost:${mcpEnv.MCP_TRINO_HTTP_PORT || "8185"}/mcp`;
const MODEL = args.model || ollamaEnv.OLLAMA_DEFAULT_MODEL || "ministral-3:3b";
const QUESTION = args.question || "Quel est mon chiffre d'affaire sur 3 mois ?";
const MAX_STEPS = 8;

// ---------------------------------------------------------------------------
// Données de test dans le lakehouse (Trino → Polaris → RustFS)
// ---------------------------------------------------------------------------

const TRINO_CONTAINER = "parus-trino";
// Catalogue d'environnement par défaut du lakehouse (le nom du catalogue
// Trino est le nom du catalogue Polaris — AGENTS.md §10).
const CATALOG = trinoEnv.POLARIS_CATALOG_NAME || "dev";
const AMOUNT_A = 1320.4; // deux commandes par mois, total mensuel constant
const AMOUNT_B = 770.85;
const MONTHLY_TOTAL = AMOUNT_A + AMOUNT_B; // 2091.25
const EXPECTED = MONTHLY_TOTAL * 3; // 3 mois glissants = 6273.75

function trino(sql) {
  // Trino durci (rbac_refonte.md §9) : HTTPS + authentification par mot de
  // passe du compte de service BFF (apps/trino/.env).
  try {
    return execFileSync(
      "docker",
      [
        "exec",
        "-e", `TRINO_PASSWORD=${trinoEnv.TRINO_SERVICE_PASSWORD ?? ""}`,
        TRINO_CONTAINER,
        "trino",
        "--server", "https://localhost:8443",
        "--user", trinoEnv.TRINO_SERVICE_USER || "parus-app",
        "--password",
        "--insecure",
        "--execute", sql,
      ],
      { encoding: "utf8" },
    );
  } catch (err) {
    throw new Error(`Trino a refusé : ${sql}\n${err.stderr || err.message}`);
  }
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function seedOrders() {
  const today = new Date();
  const rows = [];
  let id = 1;
  for (let m = 5; m >= 0; m--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - m, 15));
    rows.push(`(${id++}, DATE '${isoDate(d)}', ${AMOUNT_A.toFixed(2)})`);
    rows.push(`(${id++}, DATE '${isoDate(d)}', ${AMOUNT_B.toFixed(2)})`);
  }

  trino(`CREATE SCHEMA IF NOT EXISTS ${CATALOG}.sales`);
  trino(`DROP TABLE IF EXISTS ${CATALOG}.sales.orders`);
  trino(`CREATE TABLE ${CATALOG}.sales.orders (
    order_id INTEGER,
    order_date DATE,
    amount DECIMAL(12,2)
  )`);
  trino(`INSERT INTO ${CATALOG}.sales.orders VALUES ${rows.join(", ")}`);
  console.log(`    ${CATALOG}.sales.orders : ${rows.length} commandes sur 6 mois, total mensuel ${MONTHLY_TOTAL.toFixed(2)} €`);
}

// ---------------------------------------------------------------------------
// Client MCP (transport Streamable HTTP)
// ---------------------------------------------------------------------------

let mcpSessionId = null;
let rpcId = 0;

async function mcpCall(method, params) {
  const id = ++rpcId;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (mcpSessionId) headers["Mcp-Session-Id"] = mcpSessionId;
  const res = await fetch(MCP_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) mcpSessionId = sid;
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`MCP ${method} → HTTP ${res.status} : ${body.slice(0, 400)}`);
  }
  let msg = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    for (const line of body.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const j = JSON.parse(line.slice(5).trim());
        if (j.id === id) { msg = j; break; }
      } catch { /* évènement non JSON ignoré */ }
    }
  } else if (body.trim()) {
    msg = JSON.parse(body);
  }
  if (!msg) throw new Error(`MCP ${method} : pas de réponse JSON-RPC (corps : ${body.slice(0, 300)})`);
  if (msg.error) throw new Error(`MCP ${method} → ${JSON.stringify(msg.error)}`);
  return msg.result;
}

async function mcpNotify(method, params) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (mcpSessionId) headers["Mcp-Session-Id"] = mcpSessionId;
  const res = await fetch(MCP_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method, params }),
  });
  if (!res.ok && res.status !== 202) {
    throw new Error(`MCP notify ${method} → HTTP ${res.status}`);
  }
}

async function callTool(name, toolArgs) {
  const result = await mcpCall("tools/call", { name, arguments: toolArgs });
  const parts = result.content || [];
  const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
  return { text, isError: result.isError === true };
}

// ---------------------------------------------------------------------------
// Boucle agent : Ollama (tools) → mcp-trino → réponse
// ---------------------------------------------------------------------------

function extractNumbers(text) {
  const normalized = text
    .replace(/\u00a0/g, "") // espaces insécables
    .replace(/\u202f/g, "")
    .replace(/(\d) (\d{3})/g, "$1$2") // séparateurs de milliers
    .replace(/(\d),(\d{1,2})\b/g, "$1.$2"); // virgule décimale française
  const out = [];
  for (const m of normalized.matchAll(/-?\d+(?:\.\d+)?/g)) out.push(parseFloat(m[0]));
  return out;
}

function truncate(text, max = 600) {
  return text.length > max ? `${text.slice(0, max)}…[tronqué]` : text;
}

async function main() {
  console.log("===> Test e2e Chat IA : question → LLM → mcp-trino → Trino → réponse");
  console.log(`    Ollama     : ${OLLAMA_BASE} (modèle ${MODEL})`);
  console.log(`    mcp-trino  : ${MCP_ENDPOINT}`);
  console.log(`    Question   : « ${QUESTION} »`);
  console.log("");

  console.log("===> Données de test dans le lakehouse...");
  seedOrders();

  console.log("===> Handshake MCP...");
  const init = await mcpCall("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "parusdb-e2e", version: "0.1.0" },
  });
  await mcpNotify("notifications/initialized", {});
  const { tools } = await mcpCall("tools/list", {});
  console.log(`    Serveur : ${init.serverInfo?.name ?? "?"} v${init.serverInfo?.version ?? "?"}`);
  console.log(`    Outils  : ${tools.map((t) => t.name).join(", ")}`);
  const ollamaTools = tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.inputSchema || { type: "object", properties: {} },
    },
  }));
  console.log("");

  const systemPrompt = [
    "Tu es l'assistant analytique de ParusDB, une plateforme data lakehouse.",
    "Tu réponds en français, de façon factuelle, directe et concise.",
    `La date d'aujourd'hui est le ${new Date().toISOString().slice(0, 10)}.`,
    "Tu accèdes au lakehouse uniquement via les outils MCP du serveur Trino fournis :",
    "explore d'abord les catalogues, schémas, puis les tables et leurs colonnes,",
    "puis écris et exécute une requête SQL via execute_query.",
    "Le moteur est Trino. Dates relatives : utilise",
    "date_add('month', -3, current_date) ou current_date - INTERVAL '3' DAY.",
    "N'écris jamais l'unité dans la chaîne d'intervalle (INTERVAL '3 months'",
    "est rejeté par Trino) et ne réessaie pas une syntaxe qui vient d'être",
    "rejetée : change d'approche.",
    "Pour une question « sur N mois » : compte les N derniers mois COMPLETS,",
    "hors mois en cours —",
    "order_date >= date_trunc('month', current_date) - INTERVAL 'N' MONTH",
    "AND order_date < date_trunc('month', current_date).",
    "Restitue enfin la réponse chiffrée clairement, avec l'unité (euros).",
  ].join(" ");

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: QUESTION },
  ];

  const executedSql = [];
  let finalAnswer = null;
  let toolCallCount = 0;

  for (let step = 1; step <= MAX_STEPS; step++) {
    process.stdout.write(`===> Étape ${step} : le modèle réfléchit...\n`);
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools: ollamaTools,
        stream: false,
        ...(args.think ? { think: true } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama /api/chat → HTTP ${res.status} : ${(await res.text()).slice(0, 400)}`);
    }
    const data = await res.json();
    const msg = data.message;
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      finalAnswer = msg.content || "";
      console.log(`    Réponse finale (${data.eval_count ?? "?"} tokens générés).`);
      break;
    }

    for (const tc of msg.tool_calls) {
      const name = tc.function?.name;
      let callArgs = tc.function?.arguments;
      if (typeof callArgs === "string") {
        try { callArgs = JSON.parse(callArgs); } catch { callArgs = {}; }
      }
      toolCallCount += 1;
      if (name === "execute_query" && callArgs?.query) executedSql.push(callArgs.query);
      console.log(`    → ${name}(${JSON.stringify(callArgs)})`);
      const { text, isError } = await callTool(name, callArgs || {});
      console.log(`      ${isError ? "ERREUR" : "résultat"} : ${truncate(text.replace(/\n/g, " | "))}`);
      messages.push({
        role: "tool",
        tool_name: name,
        content: isError ? `ERREUR : ${text}` : text || "(aucun résultat)",
      });
    }
  }

  if (finalAnswer === null) {
    throw new Error(`le modèle n'a pas produit de réponse finale en ${MAX_STEPS} étapes`);
  }

  console.log("");
  console.log("===> Réponse du modèle :");
  console.log(finalAnswer.trim());
  console.log("");

  // Vérifications
  const numbers = extractNumbers(finalAnswer);
  const matched = numbers.find((n) => Math.abs(n - EXPECTED) <= Math.max(0.01, EXPECTED * 0.01));
  const sqlOk = executedSql.length > 0;
  const valueOk = matched !== undefined;

  console.log("===> SQL exécuté par le modèle via mcp-trino :");
  if (sqlOk) {
    executedSql.forEach((sql, i) => console.log(`    ${i + 1}. ${sql.replace(/\s+/g, " ")}`));
  } else {
    console.log("    (aucune requête exécutée)");
  }
  console.log("");

  console.log(`    Chiffre d'affaires attendu (3 mois) : ${EXPECTED.toFixed(2)} €`);
  console.log(`    Outils appelés                      : ${toolCallCount}`);
  console.log(`    Requête SQL exécutée                : ${sqlOk ? "oui" : "NON"}`);
  console.log(`    Montant restitué                    : ${valueOk ? `oui (${matched})` : `NON (${numbers.join(", ") || "aucun nombre trouvé"})`}`);

  if (!sqlOk || !valueOk) {
    console.log("");
    console.log("ÉCHEC : le parcours e2e n'est pas validé.");
    process.exit(1);
  }
  console.log("");
  console.log("SUCCÈS : question → SQL généré et exécuté dans Trino → réponse restituée.");
}

main().catch((err) => {
  console.error(`ÉCHEC : ${err.message}`);
  process.exit(1);
});
