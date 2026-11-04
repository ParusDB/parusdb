"use server";

import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import {
  hasGrant,
  requireSession,
  type Privilege,
} from "@/lib/session";
import { revalidatePath } from "next/cache";
import { createCatalog, deleteCatalog, ensureDefaultCatalogIsolated, DEFAULT_CATALOG } from "@/lib/polaris";
import {
  loadCatalogTree,
  trinoBindingFileContent,
  trinoBindingFor,
} from "@/lib/lakehouse";
import { quoteIdent, sessionTrinoExecutor } from "@/lib/trino";
import {
  getTrinoRestartState,
  requestTrinoRestart,
  type TrinoRestartState,
} from "@/lib/trino-restart";

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

// Privilège requis par une requête SQL : lecture pour les requêtes
// d'interrogation, écriture pour tout ce qui modifie les objets (DDL/DML).
// Heuristique sur le premier mot-clé - la garde finale reste la RLS du
// registre et la documentation de l'éditeur (AGENTS.md §10).
const READ_ONLY_SQL = /^\s*(select|show|describe|desc|explain)\b/i;

function requiredSqlPrivilege(sql: string): Privilege {
  return READ_ONLY_SQL.test(sql) ? "read" : "write";
}

export interface QueryExecution {
  ok: boolean;
  columns?: { name: string; type: string }[];
  rows?: unknown[][];
  rowCount?: number;
  durationMs?: number;
  error?: string;
}

// Exécution SQL : passe par Trino (unique moteur) sous le compte Trino du
// rôle ACTIF (contraint par rules.json - la qualification croisée de
// catalogue est refusée par Trino, pas seulement par la garde applicative)
// après vérification applicative des droits (spec §Data Lakehouse, RBAC
// refonte : message d'erreur français précoce avant d'atteindre Trino).
export async function executeQuery(
  catalog: string,
  sql: string,
): Promise<QueryExecution> {
  const session = await requireSession();
  const supabase = await createClient();
  const trimmed = sql.trim();
  if (!trimmed) {
    return { ok: false, error: "La requête est vide." };
  }
  // Lecture : privilège « Lecture » sur le catalogue ; toute requête
  // modifiante exige le privilège « Écriture ».
  const privilege = requiredSqlPrivilege(trimmed);
  const granted = await hasGrant(
    session.userId,
    "catalog",
    catalog,
    privilege,
  );
  if (!granted) {
    return {
      ok: false,
      error:
        privilege === "read"
          ? "Votre rôle actif ne permet pas de lire ce catalogue (privilège « Lecture » requis)."
          : "Votre rôle actif ne permet pas de modifier ce catalogue (privilège « Écriture » requis).",
    };
  }
  if (!session.activeRole) {
    return {
      ok: false,
      error:
        "Aucun rôle actif : impossible d'exécuter une requête. Contactez un administrateur.",
    };
  }
  const binding = trinoBindingFor(catalog);
  if (!binding) {
    return {
      ok: false,
      error:
        "Ce catalogue n'est pas encore lié à Trino. Si vous venez de le créer, son redémarrage automatique est peut-être en cours - réessayez dans un instant.",
    };
  }
  try {
    const run = await sessionTrinoExecutor(session);
    const result = await run(trimmed);
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
  const session = await requireSession();
  if (!session.activeRole) {
    return {
      ok: false,
      error: "Aucun rôle actif : impossible de créer un catalogue.",
    };
  }
  const trimmed = name.trim();
  if (!NAME_PATTERN.test(trimmed)) {
    return {
      ok: false,
      error:
        "Nom invalide : minuscules, chiffres et tirets bas uniquement (ex. prod, stg_analytics).",
    };
  }
  const supabase = await createClient();

  // Corrige le catalogue par défaut si ses allowedLocations couvrent le
  // bucket entier (install antérieure) - sinon tout nouveau catalogue
  // serait rejeté par Polaris (chevauchement de locations, HTTP 400).
  // Le flag POLARIS_FEATURES_ALLOW_OVERLAPPING_CATALOG_URLS=true dans le
  // docker-compose Polaris sert de filet de sécurité pour les installations
  // existantes ; cette correction automatique restaure l'isolation par
  // sous-répertoire quand l'API PUT est disponible.
  const isolation = await ensureDefaultCatalogIsolated();
  if (!isolation.fixed && isolation.error) {
    console.warn(
      `[parusdb] Correction du catalogue par défaut « ${DEFAULT_CATALOG} » échouée : ${isolation.error}`,
    );
  }

  // 1. Catalogue Polaris (métadonnées Iceberg).
  const created = await createCatalog(trimmed);
  if (!created.ok) {
    return created;
  }

  // 2. Registre applicatif (description). Le rôle actif qui crée le
  //    catalogue en devient propriétaire (RBAC refonte) : tous les comptes
  //    portant ce rôle le voient.
  const { error: registryError } = await supabase
    .schema("lakehouse")
    .from("catalog_registry")
    .insert({
      catalog_name: trimmed,
      description: description.trim() || null,
      created_by: session.userId,
      owner_role_id: session.activeRole.id,
    });
  if (registryError) {
    return {
      ok: false,
      error: `Le catalogue Polaris est créé mais l'enregistrement applicatif a échoué : ${registryError.message}`,
    };
  }

  // 3. Binding Trino : fichier de configuration chargé au prochain
  //    redémarrage - automatique, dès qu'aucune requête n'est en cours.
  let warning: string | undefined;
  const dir = process.env.TRINO_CATALOG_DIR;
  if (dir) {
    try {
      await writeFile(
        path.join(dir, `${trimmed}.properties`),
        trinoBindingFileContent(trimmed),
        "utf8",
      );
      requestTrinoRestart(trimmed);
      warning =
        "Catalogue créé. Trino redémarre automatiquement pour le rendre requêtable (dès qu'aucune requête n'est en cours).";
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

// Suppression d'un catalogue : confirmation + ressaisie du nom côté UI
// (action irréversible). Privilège « Gestion » requis sur le catalogue
// (propriété du rôle actif ou grant - RBAC refonte). Spec Polaris 1.8.0 : le
// catalogue doit être vide - la purge des fichiers Iceberg passe par les
// DROP Trino (la propriété polaris.config.drop-with-purge.enabled est posée
// à la création), puis le catalogue est supprimé via l'API Management.
export async function deleteCatalogAction(
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const canDelete = await hasGrant(session.userId, "catalog", name, "manage");
  if (!canDelete) {
    return {
      ok: false,
      error: "La suppression d'un catalogue exige le privilège « Gestion » (rôle propriétaire ou grant dédié).",
    };
  }
  // Le catalogue par défaut de la plateforme (catalogue système, ex. parusdb)
  // est intouchable : l'UI masque le bouton, l'action refuse quelle que soit
  // la provenance de l'appel.
  if (name === DEFAULT_CATALOG) {
    return {
      ok: false,
      error: `Le catalogue « ${DEFAULT_CATALOG} » est le catalogue système de la plateforme : il ne peut pas être supprimé.`,
    };
  }
  const binding = trinoBindingFor(name);
  if (binding) {
    try {
      // Purge exécutée sous le compte Trino du rôle actif (privilège
      // « Gestion » vérifié ci-dessus) - le refus éventuel vient de Trino.
      if (!session.activeRole) {
        return {
          ok: false,
          error: "Aucun rôle actif : impossible de supprimer ce catalogue.",
        };
      }
      const run = await sessionTrinoExecutor(session);
      const tree = await loadCatalogTree(binding, run);
      for (const schema of tree.schemas) {
        for (const table of schema.tables) {
          await run(
            `DROP TABLE IF EXISTS ${quoteIdent(binding)}.${quoteIdent(schema.name)}.${quoteIdent(table.name)}`,
          );
        }
      }
      for (const schema of tree.schemas) {
        await run(
          `DROP SCHEMA IF EXISTS ${quoteIdent(binding)}.${quoteIdent(schema.name)}`,
        );
      }
    } catch (error) {
      return {
        ok: false,
        error: `La purge des tables du catalogue a échoué : ${error instanceof Error ? error.message : "erreur inattendue"}. Supprimez le contenu manuellement puis réessayez.`,
      };
    }
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
  const session = await requireSession();
  const canManage = await hasGrant(session.userId, "catalog", name, "manage");
  if (!canManage) {
    return {
      ok: false,
      error: "Cette action exige le privilège « Gestion » sur le catalogue.",
    };
  }
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
  requestTrinoRestart(name);
  revalidatePath("/data-lakehouse");
  revalidatePath(`/data-lakehouse/${name}`);
  return {
    ok: true,
    warning:
      "Configuration générée. Trino redémarre automatiquement (dès qu'aucune requête n'est en cours).",
  };
}

// État du redémarrage automatique de Trino (polling de l'UI).
export async function getTrinoRestartStatus(): Promise<TrinoRestartState> {
  await requireSession();
  return getTrinoRestartState();
}
