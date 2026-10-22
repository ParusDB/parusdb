-- Rôle applicatif du moteur ELT dlt (apps/dlt) dans le Postgres Supabase.
--
-- Moindre privilège (skills Supabase : pas de service_role, pas de bypassrls) :
--   - LOGIN dédié avec mot de passe (fourni par setup.sh, jamais commité) ;
--   - USAGE sur le schéma connectors uniquement ;
--   - SELECT/UPDATE sur connectors.pipelines (last_run_at, statut) ;
--   - SELECT/INSERT/UPDATE sur connectors.pipeline_runs (file d'attente,
--     résultats) ;
--   - les politiques RLS correspondantes vivent dans
--     apps/supabase/sql/01-parusdb-app.sql (section connectors).
--
-- Appliqué par apps/dlt/setup.sh uniquement, via psql, connecté à la base
-- `postgres` (l'image Supabase donne le rôle SUPERUSER à `supabase_admin`,
-- pas à `postgres`) :
--   docker exec -i supabase-db psql -U supabase_admin \
--     -v db_role=<PARUSDB_DB_USER> -v db_password=<PARUSDB_DB_PASSWORD> \
--     < sql/01-dlt-role.sql
--
-- Convention AGENTS.md §9 : DDL versionné et idempotent, jamais de modification
-- manuelle via Studio.

\set ON_ERROR_STOP on

-- Rôle applicatif dédié (créé seulement s'il est absent).
SELECT format('CREATE ROLE %I LOGIN', :'db_role')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'db_role')\gexec

-- Convergence du mot de passe et des attributs si le rôle existe déjà
-- (supporte la rotation du secret dans .env).
ALTER ROLE :"db_role" LOGIN PASSWORD :'db_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Cloisonnement défensif puis moindre privilège sur le schéma applicatif.
REVOKE ALL ON SCHEMA connectors FROM :"db_role";
REVOKE ALL ON connectors.pipelines, connectors.pipeline_runs FROM :"db_role";

GRANT USAGE ON SCHEMA connectors TO :"db_role";
GRANT SELECT, UPDATE ON connectors.pipelines TO :"db_role";
GRANT SELECT, INSERT, UPDATE ON connectors.pipeline_runs TO :"db_role";
