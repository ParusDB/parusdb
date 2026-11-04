"""Accès PostgreSQL applicatif (schéma connectors) pour le runner dlt.

Connexion directe au Postgres de la stack Supabase avec le rôle dédié
`parus_dlt` (moindre privilège, créé par sql/01-dlt-role.sql) : le runner ne
passe jamais par PostgREST ni par la clé service_role. Les politiques RLS du
schéma connectors incluent des règles TO parus_dlt (01-parusdb-app.sql).
"""

import os

import psycopg2
import psycopg2.extras

# L'état applicatif (connectors.pipelines / connectors.pipeline_runs) reste la
# source de vérité transactionnelle : le lakehouse ne stocke que la donnée
# analytique (AGENTS.md §3 et §12).


def connect():
    conn = psycopg2.connect(
        host=os.environ.get("PARUSDB_DB_HOST", "db"),
        port=int(os.environ.get("PARUSDB_DB_PORT", "5432")),
        dbname=os.environ.get("PARUSDB_DB_NAME", "postgres"),
        user=os.environ.get("PARUSDB_DB_USER", "parus_dlt"),
        password=os.environ.get("PARUSDB_DB_PASSWORD", ""),
        connect_timeout=10,
    )
    # Lectures d'ordonnancement : pas de transaction longue ouverte (autocommit
    # évite aussi les snapshots périmés entre ticks).
    conn.autocommit = True
    return conn


def fetch_run(conn, run_id: str) -> dict | None:
    """Run + pipeline joint ; None si le run n'existe pas."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            select r.id as run_id, r.status as run_status, r.trigger,
                   p.id as pipeline_id, p.name, p.source_type,
                   p.source_config, p.credentials_encrypted,
                   p.selected_tables, p.write_mode, p.cron,
                   p.destination_catalog, p.destination_schema
              from connectors.pipeline_runs r
              join connectors.pipelines p on p.id = r.pipeline_id
             where r.id = %s
            """,
            (run_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def mark_running(conn, run_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            update connectors.pipeline_runs
               set status = 'running'
             where id = %s and status = 'queued'
            """,
            (run_id,),
        )
    conn.commit()


def finish_run(
    conn,
    run_id: str,
    status: str,
    message: str,
    rows_loaded: int | None,
    log: str | None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            update connectors.pipeline_runs
               set status = %s, message = %s, rows_loaded = %s,
                   log = %s, finished_at = now()
             where id = %s
            """,
            (status, message, rows_loaded, log, run_id),
        )
    conn.commit()


def run_status(conn, run_id: str) -> dict | None:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select id, pipeline_id, status from connectors.pipeline_runs "
            "where id = %s",
            (run_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def mark_pipeline(conn, pipeline_id: str, status: str | None) -> None:
    """Statut ('error'/'active') + last_run_at ; inactive reste inactive."""
    with conn.cursor() as cur:
        cur.execute(
            """
            update connectors.pipelines
               set last_run_at = now(),
                   status = case
                       when status = 'inactive' then 'inactive'
                       when %s is null then status
                       else %s
                   end
             where id = %s
            """,
            (status, status, pipeline_id),
        )
    conn.commit()


# --- Requêtes de l'ordonnanceur (runner.scheduler) -------------------------


def list_queued_runs(conn) -> list[dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            select r.id, r.pipeline_id
              from connectors.pipeline_runs r
             where r.status = 'queued'
             order by r.started_at asc
            """
        )
        return [dict(row) for row in cur.fetchall()]


def list_running_pipeline_ids(conn) -> set[str]:
    """Pipelines ayant un run en cours (verrou : un seul run actif/pipeline)."""
    with conn.cursor() as cur:
        cur.execute(
            "select distinct pipeline_id from connectors.pipeline_runs "
            "where status = 'running'"
        )
        return {str(row[0]) for row in cur.fetchall()}


def list_scheduled_pipelines(conn) -> list[dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            select id, name, cron, last_run_at
              from connectors.pipelines
             where status = 'active' and cron <> ''
            """
        )
        return [dict(row) for row in cur.fetchall()]


def insert_scheduled_run(conn, pipeline_id: str) -> str | None:
    """Insère un run 'queued' (ordonnancement CRON) et retourne son id."""
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into connectors.pipeline_runs (pipeline_id, status, trigger)
            values (%s, 'queued', 'schedule')
            returning id
            """,
            (pipeline_id,),
        )
        row = cur.fetchone()
        cur.execute(
            "update connectors.pipelines set last_run_at = now() where id = %s",
            (pipeline_id,),
        )
    conn.commit()
    return str(row[0]) if row else None
