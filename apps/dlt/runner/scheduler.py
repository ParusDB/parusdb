"""Ordonnanceur des pipelines ELT ParusDB.

Modèle d'exécution (AGENTS.md §12) : un **conteneur jetable par exécution**.
L'ordonnanceur est le seul service long-lived de apps/dlt ; il :

1. réclame les runs `queued` (lancement manuel, création de pipeline) et
   démarre pour chacun un conteneur runner `--rm` ;
2. évalue les CRON des pipelines actifs (croniter, fuseau UTC) et insère les
   runs `queued` correspondants ;
3. réconcilie les conteneurs terminés : si le runner n'a pas mis à jour la
   base (crash, OOM), le run passe en erreur avec la queue du journal ;
4. arrête les conteneurs au-delà du délai maximal.

Le runner (runner/main.py `run`) est responsable de sa propre écriture d'état
dans connectors.pipeline_runs : l'ordonnanceur ne gère que le cycle de vie des
conteneurs et l'ordonnancement. Les verrous : un seul run actif par pipeline,
PARUSDB_DLT_MAX_PARALLEL conteneurs en parallèle.
"""

import datetime
import os
import sys
import time
import traceback

import docker
from croniter import croniter

from runner import db

POLL_SECONDS = float(os.environ.get("PARUSDB_DLT_POLL_SECONDS", "5"))
MAX_PARALLEL = int(os.environ.get("PARUSDB_DLT_MAX_PARALLEL", "2"))
RUN_TIMEOUT = int(os.environ.get("PARUSDB_DLT_RUN_TIMEOUT_SECONDS", "14400"))
IMAGE = os.environ.get("PARUSDB_DLT_IMAGE", "parus-dlt-runner:1.0.0")
NETWORK = os.environ.get("PARUSDB_DLT_NETWORK", "supabase_default")
STATE_VOLUME = os.environ.get("PARUSDB_DLT_STATE_VOLUME", "parus-dlt-state")

# Environnement transmis aux conteneurs runners (aucun secret ne vit ici :
# tout vient du .env du service scheduler, jamais commité).
RUNNER_ENV_KEYS = (
    "TZ",
    "PARUSDB_DB_HOST",
    "PARUSDB_DB_PORT",
    "PARUSDB_DB_NAME",
    "PARUSDB_DB_USER",
    "PARUSDB_DB_PASSWORD",
    "PARUSDB_ENCRYPTION_KEY",
    "PARUSDB_POLARIS_URI",
    "PARUSDB_POLARIS_REALM",
    "PARUSDB_POLARIS_CLIENT_ID",
    "PARUSDB_POLARIS_CLIENT_SECRET",
    "PARUSDB_ICEBERG_CATALOG_NAME",
    "PARUSDB_S3_BUCKET",
    "PARUSDB_S3_ENDPOINT",
    "PARUSDB_S3_REGION",
    "PARUSDB_S3_ACCESS_KEY_ID",
    "PARUSDB_S3_SECRET_ACCESS_KEY",
)


def log(message: str) -> None:
    print(f"[{datetime.datetime.now(datetime.timezone.utc).isoformat()}] {message}",
          flush=True)


def runner_env(run_id: str) -> dict:
    env = {key: os.environ[key] for key in RUNNER_ENV_KEYS if key in os.environ}
    env["PARUSDB_RUN_ID"] = run_id
    return env


def spawn_runner(client: docker.DockerClient, run: dict) -> str:
    """Démarre le conteneur jetable d'un run, retourne l'id du conteneur."""
    short_id = str(run["id"]).replace("-", "")[:12]
    container = client.containers.create(
        image=IMAGE,
        name=f"parus-dlt-run-{short_id}",
        command=["python", "-m", "runner.main", "run"],
        environment=runner_env(run["id"]),
        network=NETWORK,
        volumes={STATE_VOLUME: {"bind": "/var/lib/dlt", "mode": "rw"}},
        labels={
            "parusdb.kind": "dlt-runner",
            "parusdb.run_id": str(run["id"]),
        },
        detach=True,
    )
    container.start()
    log(f"run {short_id} : conteneur jetable démarré ({container.short_id})")
    return container.id


def reconcile(client: docker.DockerClient, conn, tracked: dict) -> None:
    """Conteneurs terminés / délais dépassés ; marque les runs orphelins."""
    now = time.time()
    for run_id, info in list(tracked.items()):
        try:
            container = client.containers.get(info["cid"])
            status = container.attrs["State"]["Status"]
        except docker.errors.NotFound:
            log(f"run {run_id[:8]} : conteneur disparu")
            del tracked[run_id]
            continue
        if status in ("exited", "dead"):
            row = db.run_status(conn, run_id)
            if row is not None and row["status"] in ("queued", "running"):
                # Le runner n'a pas écrit son état final : crash conteneur
                # (avant ou après le passage à `running`).
                try:
                    tail = container.logs(tail=30).decode("utf-8", "replace")
                except Exception:
                    tail = ""
                db.finish_run(
                    conn,
                    run_id,
                    "error",
                    "Le conteneur dlt s'est arrêté avant la fin de l'exécution.",
                    None,
                    tail[-4000:],
                )
                db.mark_pipeline(conn, str(row["pipeline_id"]), "error")
                log(f"run {run_id[:8]} : crash du conteneur, run marqué en erreur")
            try:
                container.remove(force=True)
            except docker.errors.NotFound:
                pass
            del tracked[run_id]
        elif now - info["started"] > RUN_TIMEOUT:
            log(f"run {run_id[:8]} : délai dépassé, arrêt du conteneur")
            try:
                container.stop(timeout=15)
            except docker.errors.NotFound:
                pass


def dispatch_queued(client: docker.DockerClient, conn, tracked: dict) -> None:
    """Démarre les conteneurs des runs queued (concurrence + verrou/pipeline).

    Le verrou par pipeline ne compte que les runs `running` en base + les
    conteneurs déjà démarrés (tracked) : le run `queued` lui-même doit pouvoir
    être réclamé, sinon il ne partirait jamais.
    """
    if len(tracked) >= MAX_PARALLEL:
        return
    running_pipelines = db.list_running_pipeline_ids(conn)
    for run in db.list_queued_runs(conn):
        if len(tracked) >= MAX_PARALLEL:
            break
        if str(run["id"]) in tracked:
            continue
        if str(run["pipeline_id"]) in running_pipelines:
            continue
        cid = spawn_runner(client, run)
        tracked[str(run["id"])] = {
            "cid": cid,
            "started": time.time(),
            "pipeline_id": str(run["pipeline_id"]),
        }
        running_pipelines.add(str(run["pipeline_id"]))


def schedule_cron(conn) -> None:
    """Insère un run queued pour chaque pipeline actif dont le CRON est échu."""
    now = datetime.datetime.now(datetime.timezone.utc)
    for pipeline in db.list_scheduled_pipelines(conn):
        last_run = pipeline["last_run_at"]
        # Référence : dernière exécution ; à la création, le run initial vient
        # du bouton « Enregistrer » (trigger 'creation') — pas de double run.
        reference = last_run if isinstance(last_run, datetime.datetime) else now
        if reference.tzinfo is None:
            reference = reference.replace(tzinfo=datetime.timezone.utc)
        if not croniter.is_valid(pipeline["cron"]):
            log(f"pipeline {pipeline['name']} : CRON invalide "
                f"« {pipeline['cron']} », ignoré")
            continue
        due = croniter(pipeline["cron"], reference).get_next(
            datetime.datetime
        )
        if due.tzinfo is None:
            due = due.replace(tzinfo=datetime.timezone.utc)
        if due <= now:
            run_id = db.insert_scheduled_run(conn, str(pipeline["id"]))
            log(f"pipeline {pipeline['name']} : CRON échu, run {run_id} inséré")


def tick(client: docker.DockerClient, conn, tracked: dict) -> None:
    reconcile(client, conn, tracked)
    dispatch_queued(client, conn, tracked)
    schedule_cron(conn)


def loop() -> None:
    client = docker.from_env()
    conn = db.connect()
    tracked: dict = {}
    ticks = 0
    log(
        f"ordonnanceur dlt démarré (image {IMAGE}, réseau {NETWORK}, "
        f"poll {POLL_SECONDS}s, max {MAX_PARALLEL} conteneurs, "
        f"timeout {RUN_TIMEOUT}s)"
    )
    while True:
        try:
            tick(client, conn, tracked)
            ticks += 1
            if ticks % 60 == 0:
                log(f"battement : {len(tracked)} conteneur(s) en vol")
        except docker.errors.APIError:
            log("erreur API Docker pendant le tick")
            traceback.print_exc()
        except Exception:
            log("erreur inattendue pendant le tick")
            traceback.print_exc()
            try:
                conn.close()
            except Exception:
                pass
            conn = db.connect()
        time.sleep(POLL_SECONDS)
