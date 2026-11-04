-- Initialisation idempotente de la base PostgreSQL d'Apache Polaris.
-- Appliqué par apps/polaris/setup.sh, connecté à la base cible :
--   docker exec -i supabase-db psql -U supabase_admin -d <POLARIS_DB_NAME> \
--     -v db_role=<POLARIS_DB_USER> -v db_name=<POLARIS_DB_NAME> \
--     < sql/02-init-database.sql
--
-- Convention AGENTS.md §9 : DDL versionné et idempotent, jamais de modification
-- manuelle via Studio.

\set ON_ERROR_STOP on

-- Schéma applicatif des tables Polaris.
-- Le bootstrap Polaris 1.8.0 n'exécute plus CREATE SCHEMA (les scripts
-- schema-v5/v6 s'attendent à le trouver) : il doit exister avant le
-- démarrage, sinon l'initialisation échoue (SQLSTATE 3F000).
CREATE SCHEMA IF NOT EXISTS polaris_schema AUTHORIZATION :"db_role";

-- Chemin de recherche par défaut de toutes les sessions du rôle polaris
-- (serveur Polaris + admin tool) : les requêtes non qualifiées résolvent
-- d'abord polaris_schema.
ALTER ROLE :"db_role" IN DATABASE :"db_name" SET search_path TO polaris_schema, public;

-- Cloisonnement : le schéma Polaris n'est visible que de son propriétaire.
REVOKE ALL ON SCHEMA polaris_schema FROM PUBLIC;
