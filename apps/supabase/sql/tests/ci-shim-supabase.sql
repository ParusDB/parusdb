-- ---------------------------------------------------------------------------
-- CI uniquement : shim Supabase minimal pour exécuter le schéma applicatif et
-- les tests RLS sur un PostgreSQL « nu » (postgres:17) sans la stack
-- self-hosted (docker exec supabase-db). Voir .github/workflows/ci.yml, job
-- « sql ».
--
-- Reproduit uniquement les objets Supabase référencés par
-- 01-parusdb-app.sql / 02-lakehouse-catalogs.sql / tests/rls-rbac-test.sql :
--   - les rôles idoines (anon, authenticated, service_role,
--     supabase_auth_admin, supabase_admin — appliqués par le poste
--     `postgres`/superutilisateur) ;
--   - le schéma auth + la table auth.users (colonnes utilisées par le
--     trigger iam.on_auth_user_created et les fixtures de test) ;
--   - la fonction auth.uid() (lecture du claim JWT, comme GoTrue) ;
--   - la publication supabase_realtime (chat.stream_events).
--
-- N'EST JAMAIS APPLIQUÉ sur une installation réelle (la stack fournit déjà
-- ces objets). Convention AGENTS.md §9 : DDL versionné et idempotent.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

-- 1. Rôles utilisés par les GRANT/REVOKE du schéma applicatif.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role',
                           'supabase_auth_admin', 'supabase_admin']
  loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end
$$;

-- 2. Schéma + table d'authentification (subset GoTrue utile au schéma).
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  aud text default 'authenticated',
  role text default 'authenticated',
  email text unique,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  instance_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Identité du jeton : identique à la définition GoTrue/Supabase
--    (claim `sub` du JWT passé par request.jwt.claims, SECURITY DEFINER,
--    exécutable par les rôles authentifiés et anonymes).
create or replace function auth.uid()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub',
    ''
  )::uuid
$$;

revoke all on function auth.uid() from public;
grant execute on function auth.uid() to anon, authenticated;

-- Droits réels de la stack Supabase sur le schéma d'authentification :
-- les politiques RLS appellent auth.uid() sous le rôle `authenticated`.
grant usage on schema auth to anon, authenticated;

-- 4. Publication Realtime (l'ajout de chat.stream_events dans le schéma
--    applicatif teste son existence).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
