-- Création idempotente du rôle et de la base PostgreSQL d'Apache Polaris
-- dans le Postgres de la stack Supabase (apps/supabase, service `db`).
--
-- Appliqué par apps/polaris/setup.sh uniquement, via psql, connecté à la base
-- `postgres` (l'image Supabase donne le rôle SUPERUSER à `supabase_admin`,
-- pas à `postgres`) :
--   docker exec -i supabase-db psql -U supabase_admin \
--     -v db_role=<POLARIS_DB_USER> -v db_name=<POLARIS_DB_NAME> \
--     -v db_password=<POLARIS_DB_PASSWORD> < sql/01-init-cluster.sql
-- Le schéma applicatif de la base créée est initialisé par
-- sql/02-init-database.sql (connexion sur la base cible).
--
-- Convention AGENTS.md §9 : DDL versionné et idempotent, jamais de modification
-- manuelle via Studio. Les métadonnées du catalogue vivent dans une base
-- dédiée, séparée de la base applicative Supabase (AGENTS.md §10).

\set ON_ERROR_STOP on

-- Rôle applicatif dédié (non-superuser, sans création de rôles ni de bases).
-- \gexec exécute chaque ligne produite par la requête : le CREATE ROLE ne part
-- que si le rôle est absent.
SELECT format('CREATE ROLE %I LOGIN', :'db_role')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'db_role')\gexec

-- Convergence du mot de passe et des attributs si le rôle existe déjà
-- (supports la rotation du secret dans .env).
ALTER ROLE :"db_role" LOGIN PASSWORD :'db_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- Base dédiée au métastore Polaris, possédée par le rôle applicatif.
SELECT format('CREATE DATABASE %I WITH OWNER %I', :'db_name', :'db_role')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db_name')\gexec

-- Cloisonnement : seuls le rôle polaris et les superutilisateurs peuvent
-- ouvrir une connexion sur cette base (les rôles Supabase anon/authenticated
-- n'y ont pas accès).
REVOKE CONNECT ON DATABASE :"db_name" FROM PUBLIC;
