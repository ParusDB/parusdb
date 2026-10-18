"use server";

import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { createCatalog, deleteCatalog } from "@/lib/polaris";
import { trinoBindingFileContent, trinoBindingFor } from "@/lib/lakehouse";
import { trinoQuery } from "@/lib/trino";

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export interface QueryExecution {
  ok: boolean;
  columns?: { name: string; type: string }[];
  rows?: unknown[][];
  rowCount?: number;
  durationMs?: number;
  error?: string;
}

// Exécution SQL : passe par Trino (unique moteur) avec les droits du rôle
// actif vérifiés côté serveur (spec §Data Lakehouse).
export async function executeQuery(
  catalog: string,
  sql: string,
): Promise<QueryExecution> {
  const session = await requirePermission("lakehouse");
  const supabase = await createClient();
  const trimmed = sql.trim();
  if (!trimmed) {
    return { ok: false, error: "La requête est vide." };
  }
  const binding = trinoBindingFor(catalog);
  if (!binding) {
    return {
      ok: false,
      error:
        "Ce catalogue n'est pas encore lié à Trino. Générez sa configuration puis redémarrez Trino (cd apps/trino && sh run.sh restart).",
    };
  }
  try {
    const result = await trinoQuery(trimmed);
    await supabase.schema("lakehouse").from("query_history").insert({
      user_id: session.userId,
      catalog_name: catalog,
      query: trimmed.slice(0, 8000),
      status: "success",
      duration_ms: result.durationMs,
      row_count: result.rowCount,
    });
    return {
      ok: true,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      durationMs: result.durationMs,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inattendue de Trino.";
    await supabase.schema("lakehouse").from("query_history").insert({
      user_id: session.userId,
      catalog_name: catalog,
      query: trimmed.slice(0, 8000),
      status: "error",
      error: message.slice(0, 2000),
    });
    return { ok: false, error: message };
  }
}

export async function createCatalogAction(
  name: string,
  description: string,
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const session = await requirePermission("lakehouse");
  const trimmed = name.trim();
  if (!NAME_PATTERN.test(trimmed)) {
    return {
      ok: false,
      error:
        "Nom invalide : minuscules, chiffres et tirets bas uniquement (ex. prod, stg_analytics).",
    };
  }
  const supabase = await createClient();

  // 1. Catalogue Polaris (métadonnées Iceberg).
  const created = await createCatalog(trimmed);
  if (!created.ok) {
    return created;
  }

  // 2. Registre applicatif (description).
  const { error: registryError } = await supabase
    .schema("lakehouse")
    .from("catalog_registry")
    .insert({
      catalog_name: trimmed,
      description: description.trim() || null,
      created_by: session.userId,
    });
  if (registryError) {
    return {
      ok: false,
      error: `Le catalogue Polaris est créé mais l'enregistrement applicatif a échoué : ${registryError.message}`,
    };
  }

  // 3. Accès pour tous les rôles disposant de la permission lakehouse
  //    (permissions granulaires par catalogue, spec §RBAC).
  const admin = createAdminClient();
  const { data: lakehouseRoles } = await admin
    .schema("iam")
    .from("roles")
    .select("id")
    .contains("permissions", ["lakehouse"]);
  if (lakehouseRoles && lakehouseRoles.length > 0) {
    await admin.schema("lakehouse").from("catalog_access").insert(
      lakehouseRoles.map((r: { id: string }) => ({
        role_id: r.id,
        catalog_name: trimmed,
      })),
    );
  }

  // 4. Binding Trino : fichier de configuration à redémarrer.
  let warning: string | undefined;
  const dir = process.env.TRINO_CATALOG_DIR;
  if (dir) {
    try {
      await writeFile(
        path.join(dir, `${trimmed}.properties`),
        trinoBindingFileContent(trimmed),
        "utf8",
      );
      warning =
        "Catalogue créé. Redémarrez Trino pour l'interroger : cd apps/trino && sh run.sh restart.";
    } catch {
      warning =
        "Catalogue créé, mais le fichier de binding Trino n'a pas pu être écrit : vérifiez TRINO_CATALOG_DIR.";
    }
  } else {
    warning =
      "Catalogue créé. Configurez TRINO_CATALOG_DIR pour générer le binding Trino.";
  }

  revalidatePath("/data-lakehouse");
  return { ok: true, warning };
}

// Suppression d'un catalogue : confirmation admin + ressaisie du nom côté UI
// (action irréversible, purge des fichiers Iceberg).
export async function deleteCatalogAction(
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requirePermission("lakehouse");
  if (!session.has("admin.users")) {
    return {
      ok: false,
      error: "La suppression d'un catalogue est réservée aux administrateurs.",
    };
  }
  const deleted = await deleteCatalog(name);
  if (!deleted.ok) {
    return deleted;
  }
  const supabase = await createClient();
  await supabase
    .schema("lakehouse")
    .from("catalog_registry")
    .delete()
    .eq("catalog_name", name);
  const dir = process.env.TRINO_CATALOG_DIR;
  if (dir) {
    try {
      await unlink(path.join(dir, `${name}.properties`));
    } catch {
      // fichier absent : rien à nettoyer
    }
  }
  revalidatePath("/data-lakehouse");
  return { ok: true };
}

// Génère (ou régénère) le fichier de binding Trino d'un catalogue existant.
export async function generateBindingAction(
  name: string,
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  await requirePermission("lakehouse");
  const dir = process.env.TRINO_CATALOG_DIR;
  if (!dir) {
    return {
      ok: false,
      error: "TRINO_CATALOG_DIR n'est pas configuré sur le serveur.",
    };
  }
  try {
    await writeFile(
      path.join(dir, `${name}.properties`),
      trinoBindingFileContent(name),
      "utf8",
    );
  } catch (error) {
    return {
      ok: false,
      error: `L'écriture du fichier a échoué : ${error instanceof Error ? error.message : "erreur inattendue"}`,
    };
  }
  revalidatePath("/data-lakehouse");
  revalidatePath(`/data-lakehouse/${name}`);
  return {
    ok: true,
    warning: `Redémarrez Trino pour activer le catalogue : cd apps/trino && sh run.sh restart.`,
  };
}
