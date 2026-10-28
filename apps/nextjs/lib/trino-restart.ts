// Redémarrage automatique de Trino depuis le BFF.
//
// Après la création réussie d'un catalogue (binding `<catalogue>.properties`
// écrit), Trino ne charge son catalogue qu'au redémarrage : c'est l'application
// qui le redémarre, pour que l'utilisateur n'ait aucune commande à jouer.
//
// Garde-fous :
//   - le redémarrage n'a lieu que lorsque aucune requête SQL n'est en cours
//     (endpoint UI `/v1/query` du coordinateur — seuls les états actifs
//     comptent : QUEUED, PLANNING, DISPATCHING, RUNNING, en attente de
//     prérequis) ;
//   - au-delà d'un délai maximal d'attente, le redémarrage a lieu quand même
//     (Trino sera indisponible quelques secondes de toute façon) ;
//   - un seul cycle à la fois : une création pendant un cycle en cours est
//     absorbée (les bindings sont chargés ensemble au même redémarrage) ;
//   - l'état est en mémoire du processus serveur (un seul cycle possible par
//     instance) et interrogé par l'UI pour afficher « Redémarrage en cours… ».
//
// Contrainte d'exécution : le serveur Next.js doit pouvoir joindre le CLI
// Docker (`docker restart <conteneur>`) — même accès que l'ordonnanceur dlt.

import { execFile } from "node:child_process";

const TRINO_URL = process.env.TRINO_URL ?? "http://localhost:8080";
const TRINO_USER = process.env.TRINO_USER ?? "parus-app";
const TRINO_CONTAINER = process.env.TRINO_CONTAINER_NAME ?? "parus-trino";

const IDLE_POLL_MS = 2_000;
// Délai maximal d'attente d'inactivité avant de redémarrer quand même.
const IDLE_TIMEOUT_MS = 5 * 60_000;
const HEALTH_TIMEOUT_MS = 2 * 60_000;
// Retour à l'état « idle » après la fin (l'UI a le temps de voir « done »).
const DONE_RETENTION_MS = 15_000;

export type TrinoRestartPhase =
  | "idle"
  | "waiting" // requêtes encore en cours sur Trino
  | "restarting" // docker restart + attente de santé
  | "done"
  | "error";

export interface TrinoRestartState {
  phase: TrinoRestartPhase;
  catalog: string | null;
  since: number;
  error?: string;
}

let state: TrinoRestartState = { phase: "idle", catalog: null, since: 0 };
let cycleRunning = false;

export function getTrinoRestartState(): TrinoRestartState {
  return state;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Requêtes SQL actives sur Trino. `/v1/query` liste les requêtes récentes de
// toutes natures (FINISHED, FAILED inclus) : on ne compte que les états
// actifs. La vérification elle-même n'est pas une requête SQL : elle ne
// s'observe pas dans la liste. L'endpoint exige l'authentification de l'
// utilisateur applicatif (Basic auth, mot de passe vide — Trino local sans
// authentification par mot de passe).
async function activeQueryCount(): Promise<number> {
  const auth = Buffer.from(`${TRINO_USER}:`).toString("base64");
  const res = await fetch(`${TRINO_URL}/v1/query`, {
    cache: "no-store",
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    throw new Error(
      `Trino : impossible de lister les requêtes en cours (HTTP ${res.status}).`,
    );
  }
  const queries = (await res.json()) as { state?: string }[];
  const active = new Set([
    "QUEUED",
    "PLANNING",
    "DISPATCHING",
    "RUNNING",
    "WAITING_FOR_PREREQUISITES",
  ]);
  return queries.filter((q) => q.state !== undefined && active.has(q.state))
    .length;
}

async function waitForIdle(): Promise<boolean> {
  const deadline = Date.now() + IDLE_TIMEOUT_MS;
  for (;;) {
    const active = await activeQueryCount();
    if (active === 0) return true;
    if (Date.now() >= deadline) return false;
    await sleep(IDLE_POLL_MS);
  }
}

function restartContainer(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      ["restart", TRINO_CONTAINER],
      (error, _stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `le redémarrage du conteneur « ${TRINO_CONTAINER} » a échoué : ${
                stderr || error.message
              }`,
            ),
          );
        } else {
          resolve();
        }
      },
    );
  });
}

async function waitHealthy(): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  for (;;) {
    try {
      const res = await fetch(`${TRINO_URL}/v1/info`, { cache: "no-store" });
      if (res.ok) return;
    } catch {
      // pas encore prêt : on continue de patienter
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "Trino n'est pas redevenu sain à temps après le redémarrage.",
      );
    }
    await sleep(2_000);
  }
}

// Demande un redémarrage (non bloquant) : le cycle attend l'inactivité de
// Trino, redémarre le conteneur puis attend son retour à la santé. Si un
// cycle est déjà en cours, la demande est absorbée — les bindings écrits
// entre-temps seront chargés par le même redémarrage.
export function requestTrinoRestart(catalog: string): void {
  if (cycleRunning) {
    state = { ...state, catalog };
    return;
  }
  state = { phase: "waiting", catalog, since: Date.now() };
  void runRestartCycle();
}

async function runRestartCycle(): Promise<void> {
  cycleRunning = true;
  try {
    const idle = await waitForIdle();
    if (!idle) {
      // Des requêtes sont toujours actives après le délai maximal : on
      // redémarre quand même — attendre davantage laisserait le catalogue
      // ininterrogeable indéfiniment.
      console.warn(
        `[parusdb] Requêtes toujours actives sur Trino après ${IDLE_TIMEOUT_MS / 1000}s : redémarrage forcé.`,
      );
    }
    state = { phase: "restarting", catalog: state.catalog, since: Date.now() };
    await restartContainer();
    await waitHealthy();
    const catalog = state.catalog;
    state = { phase: "done", catalog, since: Date.now() };
    setTimeout(() => {
      if (state.phase === "done") {
        state = { phase: "idle", catalog: null, since: 0 };
      }
    }, DONE_RETENTION_MS).unref();
  } catch (error) {
    state = {
      phase: "error",
      catalog: state.catalog,
      since: Date.now(),
      error:
        error instanceof Error
          ? error.message
          : "Le redémarrage de Trino a échoué : erreur inattendue.",
    };
  } finally {
    cycleRunning = false;
  }
}
