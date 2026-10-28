"use server";

import { spawn } from "node:child_process";
import { createClient } from "@/lib/supabase/server";
import {
  hasGrant,
  requireSession,
  type SessionContext,
} from "@/lib/session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

// Pipelines ELT exécutés par le moteur dlt (apps/dlt). Les credentials sont
// chiffrés au repos (AES-256-GCM) et jamais renvoyés au client ni stockés en
// clair : source_config ne porte que les métadonnées (colonnes de curseur).
// L'exécution est asynchrone : l'interface insère un run `queued`, l'ordon-
// nanceur dlt démarre un conteneur jetable qui écrit le résultat
// (connectors.pipeline_runs, AGENTS.md §12).
// RBAC refonte : le pipeline appartient au rôle actif qui l'a créé ; les
// actions exigent write (modifier/lancer/désactiver) ou manage (supprimer),
// la destination d'ingestion doit être un catalogue en write (RLS en garde
// finale).

export interface PipelineInput {
  name: string;
  sourceType: string;
  sourceConfig: Record<string, string>;
  // Colonne de curseur incrémental par table (sources SQL uniquement).
  cursors: Record<string, string>;
  selectedTables: string[];
  writeMode: "incremental" | "replace";
  cron: string;
  destinationCatalog: string;
  destinationSchema: string;
}

export interface IntrospectTable {
  name: string;
  columns: { name: string; type: string }[];
  cursor: string | null;
}

export interface TestConnectionResult {
  ok: boolean;
  error?: string;
  note?: string;
  tables: IntrospectTable[];
}

const DLT_IMAGE = process.env.PARUSDB_DLT_IMAGE ?? "parus-dlt-runner:1.0.0";
const DLT_NETWORK = process.env.PARUSDB_DLT_NETWORK ?? "supabase_default";
const INTROSPECT_TIMEOUT_MS = 90_000;

// Droit requis sur le pipeline, avec message français (la RLS reste la
// garde finale côté base).
async function assertPipelineGrant(
  session: SessionContext,
  pipelineId: string,
  privilege: "write" | "manage",
): Promise<{ ok: boolean; error?: string }> {
  const granted = await hasGrant(
    session.userId,
    "pipeline",
    pipelineId,
    privilege,
  );
  if (granted) return { ok: true };
  return {
    ok: false,
    error:
      privilege === "manage"
        ? "Seuls les membres du rôle propriétaire (ou un rôle avec le privilège « Gestion ») peuvent supprimer ce pipeline."
        : "Votre rôle actif ne permet pas de modifier ou lancer ce pipeline (privilège « Écriture » requis).",
  };
}

// Test de connexion + introspection réels : conteneur jetable du runner dlt
// (job JSON sur stdin, réponse JSON sur stdout — les credentials transitent
// par stdin, jamais par l'environnement ni le disque).
export async function testConnection(
  sourceType: string,
  config: Record<string, string>,
): Promise<TestConnectionResult> {
  await requireSession();
  const job = JSON.stringify({
    source_type: sourceType,
    credentials: config,
    tables: [],
    cursors: {},
  });
  try {
    const { stdout, stderr, code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((resolve, reject) => {
      const child = spawn(
        "docker",
        [
          "run",
          "--rm",
          "-i",
          "--network",
          DLT_NETWORK,
          DLT_IMAGE,
          "python",
          "-m",
          "runner.main",
          "introspect",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("timeout"));
      }, INTROSPECT_TIMEOUT_MS);
      child.stdout.on("data", (chunk) => (out += chunk.toString()));
      child.stderr.on("data", (chunk) => (err += chunk.toString()));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({ stdout: out, stderr: err, code: exitCode });
      });
      child.stdin.write(job);
      child.stdin.end();
    });
    // Le runner répond en JSON sur stdout ; les logs dlt vont sur stderr.
    let payload: {
      ok?: boolean;
      error?: string;
      note?: string;
      tables?: IntrospectTable[];
    } | null = null;
    try {
      payload = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
    } catch {
      payload = null;
    }
    if (payload && typeof payload.ok === "boolean") {
      return {
        ok: payload.ok,
        error: payload.error,
        note: payload.note,
        tables: payload.tables ?? [],
      };
    }
    const detail = (stderr.trim().split("\n").findLast(Boolean) ?? "").slice(0, 300);
    return {
      ok: false,
      error:
        code === null
          ? "La connexion a échoué : délai dépassé."
          : `La connexion a échoué : ${detail || `le runner dlt a quitté (code ${code}).`}`,
      tables: [],
    };
  } catch (error) {
    if (error instanceof Error && error.message === "timeout") {
      return {
        ok: false,
        error: "La connexion a échoué : délai dépassé (90 s).",
        tables: [],
      };
    }
    return {
      ok: false,
      error:
        "La connexion a échoué : docker est-il installé et l'image du runner dlt construite (cd apps/dlt && sh run.sh build) ?",
      tables: [],
    };
  }
}

// Credentials chiffrés AES-256-GCM (lib/crypto.ts, clé hors base) — le
// runner dlt déchiffre avec la même clé (apps/dlt/runner/crypto.py).
function pipelineCredentials(sourceConfig: Record<string, string>) {
  return encryptSecret(JSON.stringify(sourceConfig));
}

async function insertPipelineRow(input: PipelineInput): Promise<string> {
  const session = await requireSession();
  if (!session.activeRole) {
    throw new Error("Aucun rôle actif : impossible d'enregistrer un pipeline.");
  }
  const writable = await hasGrant(
    session.userId,
    "catalog",
    input.destinationCatalog,
    "write",
  );
  if (!writable) {
    throw new Error(
      "Votre rôle actif ne peut pas ingérer vers ce catalogue (privilège « Écriture » requis sur la destination).",
    );
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("connectors")
    .from("pipelines")
    .insert({
      owner_id: session.userId,
      // Le rôle actif qui crée le pipeline en devient propriétaire (RBAC
      // refonte) : tous les comptes portant ce rôle le voient.
      owner_role_id: session.activeRole.id,
      name: input.name,
      source_type: input.sourceType,
      source_config: { cursors: input.cursors },
      credentials_encrypted: pipelineCredentials(input.sourceConfig),
      selected_tables: input.selectedTables,
      write_mode: input.writeMode,
      cron: input.cron,
      destination_catalog: input.destinationCatalog,
      destination_schema: input.destinationSchema,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `L'enregistrement du pipeline a échoué : ${error?.message ?? "erreur inattendue"}`,
    );
  }
  return data.id;
}

async function queueRun(
  pipelineId: string,
  trigger: "creation" | "manual",
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .schema("connectors")
    .from("pipeline_runs")
    .insert({ pipeline_id: pipelineId, status: "queued", trigger });
  if (error) {
    return {
      ok: false,
      error: `La mise en file d'exécution a échoué : ${error.message}`,
    };
  }
  const { error: updateError } = await supabase
    .schema("connectors")
    .from("pipelines")
    .update({ last_run_at: new Date().toISOString() })
    .eq("id", pipelineId);
  if (updateError) {
    return {
      ok: false,
      error: `La mise à jour du pipeline a échoué : ${updateError.message}`,
    };
  }
  return { ok: true };
}

export async function createPipeline(input: PipelineInput) {
  await requireSession();
  const id = await insertPipelineRow(input);
  // « Enregistrer » = sauvegarde + lancement immédiat (spec §Connecteurs) :
  // le run part dès que l'ordonnanceur dlt le réclame (quelques secondes).
  await queueRun(id, "creation");
  revalidatePath("/connectors");
  redirect(`/connectors?created=${id}`);
}

export async function updatePipeline(id: string, input: PipelineInput) {
  const session = await requireSession();
  const check = await assertPipelineGrant(session, id, "write");
  if (!check.ok) throw new Error(check.error);
  const supabase = await createClient();

  // Credentials laissés vides en édition : conserver les valeurs chiffrées
  // existantes (jamais renvoyées au client). Champs renseignés : fusion par-
  // dessus les valeurs existantes puis re-chiffrement.
  const { data: existing } = await supabase
    .schema("connectors")
    .from("pipelines")
    .select("credentials_encrypted")
    .eq("id", id)
    .maybeSingle();
  let credentials = null;
  if (existing?.credentials_encrypted) {
    try {
      const stored = JSON.parse(
        decryptSecret(existing.credentials_encrypted),
      ) as Record<string, string>;
      Object.assign(stored, input.sourceConfig);
      credentials = pipelineCredentials(stored);
    } catch {
      // Clé de chiffrement pivotée : remplacer intégralement.
      credentials = pipelineCredentials(input.sourceConfig);
    }
  } else if (Object.keys(input.sourceConfig).length > 0) {
    credentials = pipelineCredentials(input.sourceConfig);
  }

  const payload: Record<string, unknown> = {
    name: input.name,
    source_type: input.sourceType,
    source_config: { cursors: input.cursors },
    selected_tables: input.selectedTables,
    write_mode: input.writeMode,
    cron: input.cron,
    destination_catalog: input.destinationCatalog,
    destination_schema: input.destinationSchema,
  };
  if (credentials) {
    payload.credentials_encrypted = credentials;
  }
  const { error } = await supabase
    .schema("connectors")
    .from("pipelines")
    .update(payload)
    .eq("id", id);
  if (error) {
    throw new Error(`La mise à jour a échoué : ${error.message}`);
  }
  revalidatePath("/connectors");
  redirect("/connectors");
}

export async function deletePipeline(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const check = await assertPipelineGrant(session, id, "manage");
  if (!check.ok) return check;
  const supabase = await createClient();
  const { error } = await supabase
    .schema("connectors")
    .from("pipelines")
    .delete()
    .eq("id", id);
  if (error) {
    return { ok: false, error: `La suppression a échoué : ${error.message}` };
  }
  revalidatePath("/connectors");
  return { ok: true };
}

// Exécution manuelle : run mis en file (queued), l'ordonnanceur dlt démarre
// le conteneur jetable (quelques secondes de latence d'ordonnancement).
export async function runPipeline(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const check = await assertPipelineGrant(session, id, "write");
  if (!check.ok) return check;
  const supabase = await createClient();
  const { data: pipeline } = await supabase
    .schema("connectors")
    .from("pipelines")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!pipeline) {
    return { ok: false, error: "Pipeline introuvable." };
  }
  const result = await queueRun(id, "manual");
  revalidatePath("/connectors");
  return result;
}

// Activation / désactivation de l'ordonnancement.
export async function togglePipeline(
  id: string,
  next: "active" | "inactive",
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const check = await assertPipelineGrant(session, id, "write");
  if (!check.ok) return check;
  const supabase = await createClient();
  const { error } = await supabase
    .schema("connectors")
    .from("pipelines")
    .update({ status: next })
    .eq("id", id);
  if (error) {
    return { ok: false, error: `Le changement d'état a échoué : ${error.message}` };
  }
  revalidatePath("/connectors");
  return { ok: true };
}
