"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { encryptSecret } from "@/lib/crypto";
import { findSource } from "@/lib/sources";

// Pipelines ELT (dlt). NB : le moteur d'exécution n'est pas encore intégré —
// les interfaces sont mockées : le test de connexion valide la saisie et
// l'exécution est simulée (statut + run enregistrés). Les credentials sont
// chiffrés au repos et jamais renvoyés au client (AGENTS.md §12).

export interface PipelineInput {
  name: string;
  sourceType: string;
  sourceConfig: Record<string, string>;
  selectedTables: string[];
  writeMode: "incremental" | "replace";
  cron: string;
  destinationCatalog: string;
}

// Test de connexion (mock) : valide que les champs requis sont renseignés.
export async function testConnection(
  sourceType: string,
  config: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("connectors");
  await new Promise((r) => setTimeout(r, 700));
  const source = findSource(sourceType);
  if (!source) {
    return { ok: false, error: "Source inconnue." };
  }
  const missing = source.fields
    .filter((f) => f.required !== false)
    .filter((f) => !config[f.key]?.trim());
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Champs manquants : ${missing.map((f) => f.label).join(", ")}.`,
    };
  }
  return { ok: true };
}

async function insertPipelineRow(
  input: PipelineInput,
): Promise<string> {
  const session = await requirePermission("connectors");
  const supabase = await createClient();
  const credentials: Record<string, string> = {};
  const source = findSource(input.sourceType);
  for (const field of source?.fields ?? []) {
    if (input.sourceConfig[field.key]) {
      credentials[field.key] = input.sourceConfig[field.key];
    }
  }
  const { data, error } = await supabase
    .schema("connectors")
    .from("pipelines")
    .insert({
      owner_id: session.userId,
      name: input.name,
      source_type: input.sourceType,
      source_config: { fields: input.sourceConfig },
      credentials_encrypted: Object.keys(credentials).length
        ? encryptSecret(JSON.stringify(credentials))
        : null,
      selected_tables: input.selectedTables,
      write_mode: input.writeMode,
      cron: input.cron,
      destination_catalog: input.destinationCatalog,
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

export async function createPipeline(input: PipelineInput) {
  const id = await insertPipelineRow(input);
  revalidatePath("/connectors");
  redirect(`/connectors?created=${id}`);
}

export async function updatePipeline(id: string, input: PipelineInput) {
  await requirePermission("connectors");
  const supabase = await createClient();
  const source = findSource(input.sourceType);
  const credentials: Record<string, string> = {};
  for (const field of source?.fields ?? []) {
    if (input.sourceConfig[field.key]) {
      credentials[field.key] = input.sourceConfig[field.key];
    }
  }
  // Champs credentials laissés vides en édition : on conserve les valeurs
  // chiffrées existantes (jamais renvoyées au client).
  const payload: Record<string, unknown> = {
    name: input.name,
    source_type: input.sourceType,
    source_config: { fields: input.sourceConfig },
    selected_tables: input.selectedTables,
    write_mode: input.writeMode,
    cron: input.cron,
    destination_catalog: input.destinationCatalog,
  };
  if (Object.keys(credentials).length > 0) {
    payload.credentials_encrypted = encryptSecret(JSON.stringify(credentials));
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
  await requirePermission("connectors");
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

// Exécution manuelle (mock) : enregistre un run simulé.
export async function runPipeline(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requirePermission("connectors");
  const supabase = await createClient();
  const { data: pipeline } = await supabase
    .schema("connectors")
    .from("pipelines")
    .select("id, selected_tables")
    .eq("id", id)
    .maybeSingle();
  if (!pipeline) {
    return { ok: false, error: "Pipeline introuvable." };
  }
  const tables = (pipeline.selected_tables ?? []) as string[];
  const { error: runError } = await supabase
    .schema("connectors")
    .from("pipeline_runs")
    .insert({
      pipeline_id: id,
      status: "success",
      message: `Exécution simulée : le moteur dlt n'est pas encore intégré (${tables.length} table(s) sélectionnée(s)).`,
      rows_loaded: tables.length * 100,
      finished_at: new Date().toISOString(),
    });
  if (runError) {
    return {
      ok: false,
      error: `L'exécution a échoué : ${runError.message}`,
    };
  }
  const { error: updateError } = await supabase
    .schema("connectors")
    .from("pipelines")
    .update({ last_run_at: new Date().toISOString() })
    .eq("id", id);
  if (updateError) {
    return { ok: false, error: `La mise à jour a échoué : ${updateError.message}` };
  }
  revalidatePath("/connectors");
  void session;
  return { ok: true };
}

// Activation / désactivation de l'ordonnancement.
export async function togglePipeline(
  id: string,
  next: "active" | "inactive",
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("connectors");
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
