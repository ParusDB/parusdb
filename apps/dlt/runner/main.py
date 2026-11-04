"""Point d'entrée du runner dlt ParusDB.

Trois commandes :

- `run`        : exécute un pipeline (PARUSDB_RUN_ID), conteneur jetable ;
- `introspect` : test de connexion + découverte des tables (job JSON sur
                 stdin, réponse JSON sur stdout) — utilisé par le wizard du BFF ;
- `catalog`    : registre machine des sources (génère lib/sources.ts) ;
- `schedule`   : boucle d'ordonnancement (conteneur service long-lived).

Les messages d'erreur sont en français, factuels et actionnables
(AGENTS.md §6).
"""

import json
import os
import re
import sys
import tempfile
import traceback

import dlt

from runner import db, destination, sources


def snake_case(value: str) -> str:
    value = re.sub(r"[^0-9a-zA-Z]+", "_", value).strip("_").lower()
    return value or "dataset"


def _row_counts(pipeline) -> int:
    """Nombre de lignes chargées d'après le normalize info (hors tables dlt)."""
    try:
        counts = pipeline.last_trace.last_normalize_info.row_counts or {}
    except Exception:
        return 0
    return int(sum(count for name, count in counts.items()
                   if not name.startswith("_dlt_")))


def _table_summary(pipeline) -> str:
    try:
        counts = pipeline.last_trace.last_normalize_info.row_counts or {}
    except Exception:
        return ""
    parts = [f"{name} ({count})"
             for name, count in sorted(counts.items())
             if not name.startswith("_dlt_") and count]
    return ", ".join(parts)


def _run_job(run_row: dict) -> None:
    pipeline_name = f"parus_{str(run_row['pipeline_id']).replace('-', '')[:16]}"
    dataset = snake_case(run_row["destination_schema"] or run_row["name"])
    credentials = {}
    if run_row.get("credentials_encrypted"):
        from runner import crypto

        encryption_key = os.environ.get("PARUSDB_ENCRYPTION_KEY", "")
        if not encryption_key:
            raise RuntimeError(
                "PARUSDB_ENCRYPTION_KEY manquante dans l'environnement du "
                "runner : les credentials chiffrés ne peuvent pas être lus."
            )
        blob = crypto.decrypt_secret(run_row["credentials_encrypted"], encryption_key)
        credentials = json.loads(blob)

    source_config = run_row.get("source_config") or {}
    if isinstance(source_config, str):
        source_config = json.loads(source_config)
    spec = {
        "source_type": run_row["source_type"],
        "credentials": credentials,
        "tables": run_row.get("selected_tables") or [],
        "cursors": source_config.get("cursors") or {},
    }

    # Répertoire de travail propre au run : la config dlt (secrets.toml du
    # catalogue Iceberg) y vit, l'état persiste dans ~/.dlt (volume Docker).
    workdir = tempfile.mkdtemp(prefix="parus-run-")
    os.chdir(workdir)
    destination.write_iceberg_secrets(workdir, run_row["destination_catalog"])
    destination.ensure_namespace(run_row["destination_catalog"], dataset)

    source = sources.build_source(spec)
    kind = sources.kind_of(spec["source_type"])
    # Modes d'insertion (spec §Connecteurs) :
    #   - replace : recréation complète à chaque exécution ;
    #   - incremental : merge sur clé primaire si la source en expose (upsert :
    #     une ligne modifiée remplace l'ancienne version), sinon append.
    #   Les sources verified conservent leurs write_dispositions intégrés.
    if run_row["write_mode"] == "replace":
        write_disposition = "replace"
    elif kind in ("sql", "endpoints", "globs"):
        write_disposition = (
            "merge"
            if kind == "sql" and sources.has_primary_keys(source)
            else "append"
        )
    else:
        write_disposition = None

    pipeline = dlt.pipeline(
        pipeline_name=pipeline_name,
        destination="filesystem",
        dataset_name=dataset,
    )
    if write_disposition:
        pipeline.run(source, write_disposition=write_disposition,
                      table_format="iceberg")
    else:
        # Sources verified : conserver leurs write_dispositions intégrés
        # (merge/incrémental natifs), au format Iceberg.
        pipeline.run(source, table_format="iceberg")

    rows = _row_counts(pipeline)
    summary = _table_summary(pipeline)
    message = (
        f"Chargement réussi vers {run_row['destination_catalog']}.{dataset} "
        f"({rows} ligne(s))"
    )
    if summary:
        message = f"{message} : {summary}"
    message = f"{message}."
    print(message)
    return message, rows


def cmd_run() -> int:
    run_id = os.environ.get("PARUSDB_RUN_ID")
    if not run_id:
        print("PARUSDB_RUN_ID manquante : le runner doit être lancé par "
              "l'ordonnanceur.", file=sys.stderr)
        return 2
    conn = db.connect()
    run_row = db.fetch_run(conn, run_id)
    if run_row is None:
        print(f"Run {run_id} introuvable dans connectors.pipeline_runs.",
              file=sys.stderr)
        return 2
    db.mark_running(conn, run_id)
    print(f"Run {run_id} : pipeline « {run_row['name']} » "
          f"({run_row['source_type']}) vers "
          f"{run_row['destination_catalog']}.{run_row['destination_schema']}")

    try:
        message, rows = _run_job(run_row)
        db.finish_run(conn, run_id, "success", message, rows, None)
        db.mark_pipeline(conn, str(run_row["pipeline_id"]), "active")
        return 0
    except Exception:
        log = traceback.format_exc()
        print(log, file=sys.stderr)
        db.finish_run(
            conn,
            run_id,
            "error",
            "L'exécution a échoué — consultez le journal du run.",
            None,
            log[-8000:],
        )
        db.mark_pipeline(conn, str(run_row["pipeline_id"]), "error")
        return 1


def cmd_introspect() -> int:
    raw = sys.stdin.read()
    try:
        spec = json.loads(raw)
        result = sources.introspect(spec)
    except Exception as exc:
        result = {"ok": False, "error": f"La connexion a échoué : {exc}"}
        print(json.dumps(result, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


def cmd_catalog() -> int:
    print(json.dumps(sources.catalog(), ensure_ascii=False))
    return 0


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else "run"
    if command == "run":
        return cmd_run()
    if command == "introspect":
        return cmd_introspect()
    if command == "catalog":
        return cmd_catalog()
    if command == "schedule":
        from runner import scheduler

        scheduler.loop()
        return 0
    print(f"Commande inconnue : {command}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
