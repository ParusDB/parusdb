-- ============================================================================
-- ParusDB — Schéma applicatif (bases transactionnelles)
-- ============================================================================
-- Fichier SQL versionné et idempotent (convention AGENTS.md §9 : toute
-- modification DDL passe par un fichier SQL commité, jamais via Studio).
--
-- Répartition par schéma métier :
--   iam        — profils, rôles applicatifs, permissions, rôle actif
--   agents     — agents IA et leurs sources de connaissances
--   chat       — conversations et messages
--   lakehouse  — registre des catalogues, accès par rôle, historique SQL
--   connectors — pipelines ELT (dlt) et leurs exécutions
--   admin      — modèles LLM propriétaires (clés chiffrées), serveurs locaux
--   support    — tickets support
--
-- PostgreSQL reste la source de vérité TRANSACTIONNELLE (config, RBAC,
-- métadonnées) ; les données analytiques vivent dans le lakehouse (Polaris +
-- Trino + RustFS), jamais ici (AGENTS.md §10).
--
-- Application sur une base déjà initialisée :
--   docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     < apps/supabase/sql/01-parusdb-app.sql
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Schémas métier et droits
-- ---------------------------------------------------------------------------

create schema if not exists iam;
create schema if not exists agents;
create schema if not exists chat;
create schema if not exists lakehouse;
create schema if not exists connectors;
create schema if not exists admin;
create schema if not exists support;

-- Les schémas métier ne sont jamais exposés à l'anonyme ; les requêtes
-- authentifiées passent par PostgREST (rôle `authenticated`) et sont filtrées
-- par RLS ci-dessous.
revoke all on schema iam, agents, chat, lakehouse, connectors, admin, support
  from anon;
grant usage on schema iam, agents, chat, lakehouse, connectors, admin, support
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Fonctions communes (iam)
-- ---------------------------------------------------------------------------

-- updated_at commun à toutes les tables qui le portent.
create or replace function iam.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. iam — profils, rôles, permissions
-- ---------------------------------------------------------------------------

create table if not exists iam.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text,
  last_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists iam.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  permissions text[] not null default '{}',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_key_format check (key ~ '^[a-z][a-z0-9_]*$')
);

create table if not exists iam.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid not null references iam.roles (id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create index if not exists user_roles_role_id_idx on iam.user_roles (role_id);

create table if not exists iam.user_active_role (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role_id uuid not null references iam.roles (id) on delete cascade,
  updated_at timestamptz not null default now()
);
create index if not exists user_active_role_role_id_idx on iam.user_active_role (role_id);

-- Rôle actif et permissions : fondation du RBAC applicatif. Définis après les
-- tables iam (les fonctions SQL standard sont validées à la création).
-- Les décisions d'autorisation ne JAMAIS s'appuyer sur raw_user_meta_data
-- (éditable par l'utilisateur) — tout vit dans ces tables (AGENTS.md §9).

-- Rôle actif de l'utilisateur : la ligne choisie, sinon le premier rôle attribué.
-- (sécurité invoker : l'utilisateur lit ses propres lignes, toutes lisibles par
-- ses politiques RLS)
create or replace function iam.active_role_id(p_user uuid)
returns uuid
language sql
stable
security invoker
set search_path = iam, pg_catalog
as $$
  select coalesce(
    (select uar.role_id
       from iam.user_active_role uar
      where uar.user_id = p_user),
    (select ur.role_id
       from iam.user_roles ur
      where ur.user_id = p_user
      order by ur.granted_at
      limit 1)
  );
$$;

-- Permission du rôle actif de l'utilisateur.
create or replace function iam.has_permission(p_user uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = iam, pg_catalog
as $$
  select exists (
    select 1
      from iam.roles r
     where r.id = iam.active_role_id(p_user)
       and p_permission = any (r.permissions)
  );
$$;

revoke all on function iam.has_permission(uuid, text) from public;
grant execute on function iam.has_permission(uuid, text) to authenticated;
revoke all on function iam.active_role_id(uuid) from public;
grant execute on function iam.active_role_id(uuid) to authenticated;

alter table iam.user_profiles enable row level security;
alter table iam.roles enable row level security;
alter table iam.user_roles enable row level security;
alter table iam.user_active_role enable row level security;

drop policy if exists profiles_select_own_or_admin on iam.user_profiles;
create policy profiles_select_own_or_admin on iam.user_profiles
  for select to authenticated
  using (id = (select auth.uid()) or iam.has_permission(auth.uid(), 'admin.users'));

drop policy if exists profiles_insert_own on iam.user_profiles;
create policy profiles_insert_own on iam.user_profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists profiles_update_own_or_admin on iam.user_profiles;
create policy profiles_update_own_or_admin on iam.user_profiles
  for update to authenticated
  using (id = (select auth.uid()) or iam.has_permission(auth.uid(), 'admin.users'))
  with check (id = (select auth.uid()) or iam.has_permission(auth.uid(), 'admin.users'));

drop policy if exists roles_select_all on iam.roles;
create policy roles_select_all on iam.roles
  for select to authenticated
  using (true);

drop policy if exists roles_admin_write on iam.roles;
create policy roles_admin_write on iam.roles
  for all to authenticated
  using (iam.has_permission(auth.uid(), 'admin.roles'))
  with check (iam.has_permission(auth.uid(), 'admin.roles'));

drop policy if exists user_roles_select_own_or_admin on iam.user_roles;
create policy user_roles_select_own_or_admin on iam.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or iam.has_permission(auth.uid(), 'admin.users'));

drop policy if exists user_roles_admin_write on iam.user_roles;
create policy user_roles_admin_write on iam.user_roles
  for all to authenticated
  using (iam.has_permission(auth.uid(), 'admin.users'))
  with check (iam.has_permission(auth.uid(), 'admin.users'));

drop policy if exists active_role_select_own on iam.user_active_role;
create policy active_role_select_own on iam.user_active_role
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists active_role_write_own on iam.user_active_role;
create policy active_role_write_own on iam.user_active_role
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from iam.user_roles ur
       where ur.user_id = auth.uid() and ur.role_id = user_active_role.role_id
    )
  );

drop trigger if exists touch_user_profiles on iam.user_profiles;
create trigger touch_user_profiles before update on iam.user_profiles
  for each row execute function iam.touch_updated_at();
drop trigger if exists touch_roles on iam.roles;
create trigger touch_roles before update on iam.roles
  for each row execute function iam.touch_updated_at();
drop trigger if exists touch_user_active_role on iam.user_active_role;
create trigger touch_user_active_role before update on iam.user_active_role
  for each row execute function iam.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. agents — agents IA et sources de connaissances
-- ---------------------------------------------------------------------------

create table if not exists agents.agents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  model_provider text not null default 'ollama'
    check (model_provider in ('ollama', 'openai', 'anthropic', 'mistral', 'custom')),
  model_id text not null,
  system_prompt text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agents_owner_id_idx on agents.agents (owner_id);

-- Sources de connaissances d'un agent : catalogues du lakehouse autorisés au
-- rôle actif du propriétaire au moment de la création (spec §Agents IA).
create table if not exists agents.agent_sources (
  agent_id uuid not null references agents.agents (id) on delete cascade,
  source_type text not null default 'catalog' check (source_type in ('catalog')),
  source_name text not null,
  primary key (agent_id, source_type, source_name)
);
create index if not exists agent_sources_agent_id_idx on agents.agent_sources (agent_id);

alter table agents.agents enable row level security;
alter table agents.agent_sources enable row level security;

-- Lecture des agents : CRUD réservé à la permission `agents`, mais tout
-- utilisateur avec la permission `chat` doit pouvoir choisir un agent pour
-- démarrer une conversation (spec §Chat / §Rôles).
drop policy if exists agents_select_perm on agents.agents;
create policy agents_select_perm on agents.agents
  for select to authenticated
  using (
    iam.has_permission(auth.uid(), 'agents')
    or iam.has_permission(auth.uid(), 'chat')
  );

drop policy if exists agents_insert_own on agents.agents;
create policy agents_insert_own on agents.agents
  for insert to authenticated
  with check (iam.has_permission(auth.uid(), 'agents') and owner_id = (select auth.uid()));

drop policy if exists agents_update_own on agents.agents;
create policy agents_update_own on agents.agents
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists agents_delete_own on agents.agents;
create policy agents_delete_own on agents.agents
  for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists agent_sources_select_perm on agents.agent_sources;
create policy agent_sources_select_perm on agents.agent_sources
  for select to authenticated
  using (iam.has_permission(auth.uid(), 'agents'));

drop policy if exists agent_sources_write_own on agents.agent_sources;
create policy agent_sources_write_own on agents.agent_sources
  for all to authenticated
  using (
    exists (
      select 1 from agents.agents a
       where a.id = agent_sources.agent_id and a.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from agents.agents a
       where a.id = agent_sources.agent_id and a.owner_id = auth.uid()
    )
  );

drop trigger if exists touch_agents on agents.agents;
create trigger touch_agents before update on agents.agents
  for each row execute function iam.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. chat — conversations et messages
-- ---------------------------------------------------------------------------

-- L'agent est immuable après création de la conversation (spec §Chat) : pas de
-- modification possible côté app, et l'agent ne peut pas être supprimé tant
-- que des conversations y font référence (on delete restrict).
create table if not exists chat.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  agent_id uuid not null references agents.agents (id) on delete restrict,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_owner_idx on chat.conversations (owner_id, updated_at desc);
create index if not exists conversations_agent_idx on chat.conversations (agent_id);

create table if not exists chat.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on chat.messages (conversation_id, created_at);

alter table chat.conversations enable row level security;
alter table chat.messages enable row level security;

drop policy if exists conversations_owner_all on chat.conversations;
create policy conversations_owner_all on chat.conversations
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists messages_select_own on chat.messages;
create policy messages_select_own on chat.messages
  for select to authenticated
  using (
    exists (
      select 1 from chat.conversations c
       where c.id = messages.conversation_id and c.owner_id = auth.uid()
    )
  );

drop policy if exists messages_insert_own on chat.messages;
create policy messages_insert_own on chat.messages
  for insert to authenticated
  with check (
    exists (
      select 1 from chat.conversations c
       where c.id = messages.conversation_id and c.owner_id = auth.uid()
    )
  );

drop policy if exists messages_delete_own on chat.messages;
create policy messages_delete_own on chat.messages
  for delete to authenticated
  using (
    exists (
      select 1 from chat.conversations c
       where c.id = messages.conversation_id and c.owner_id = auth.uid()
    )
  );

drop trigger if exists touch_conversations on chat.conversations;
create trigger touch_conversations before update on chat.conversations
  for each row execute function iam.touch_updated_at();

-- Évènements de diffusion d'une réponse d'agent : transport **Supabase
-- Realtime** (spec §Chat / §Notes). Le BFF insère une ligne par évènement
-- (statut, outil, fragment de réponse, fin) ; le navigateur s'abonne aux
-- INSERT via postgres_changes, filtrés par conversation et protégés par RLS.
create table if not exists chat.stream_events (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references chat.conversations (id) on delete cascade,
  kind text not null check (kind in ('status', 'tool', 'tool_result', 'token', 'done', 'error')),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists stream_events_conversation_idx
  on chat.stream_events (conversation_id, id);

alter table chat.stream_events enable row level security;

drop policy if exists stream_events_owner_all on chat.stream_events;
create policy stream_events_owner_all on chat.stream_events
  for all to authenticated
  using (
    exists (
      select 1 from chat.conversations c
       where c.id = stream_events.conversation_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from chat.conversations c
       where c.id = stream_events.conversation_id and c.owner_id = auth.uid()
    )
  );

grant select, insert, delete on chat.stream_events to authenticated;

-- Publication Realtime (WAL) — idempotent.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'chat'
       and tablename = 'stream_events'
  ) then
    execute 'alter publication supabase_realtime add table chat.stream_events';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. lakehouse — registre des catalogues, accès par rôle, historique SQL
-- ---------------------------------------------------------------------------
-- Polaris reste la source de vérité des catalogues (métadonnées Iceberg) ;
-- ce registre ne conserve que la description applicative et le RBAC par rôle.

create table if not exists lakehouse.catalog_registry (
  catalog_name text primary key,
  description text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Quels rôles peuvent voir/quels catalogues (spec : permissions granulaires
-- par catalogue). Alimenté par l'app à la création d'un catalogue (tous les
-- rôles disposant de la permission lakehouse) et ajustable côté admin.
create table if not exists lakehouse.catalog_access (
  role_id uuid not null references iam.roles (id) on delete cascade,
  catalog_name text not null references lakehouse.catalog_registry (catalog_name) on delete cascade,
  primary key (role_id, catalog_name)
);
create index if not exists catalog_access_catalog_idx on lakehouse.catalog_access (catalog_name);

create table if not exists lakehouse.query_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  catalog_name text not null,
  query text not null,
  status text not null check (status in ('success', 'error')),
  duration_ms integer,
  row_count integer,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists query_history_user_idx on lakehouse.query_history (user_id, created_at desc);

alter table lakehouse.catalog_registry enable row level security;
alter table lakehouse.catalog_access enable row level security;
alter table lakehouse.query_history enable row level security;

drop policy if exists catalog_registry_select_perm on lakehouse.catalog_registry;
create policy catalog_registry_select_perm on lakehouse.catalog_registry
  for select to authenticated
  using (iam.has_permission(auth.uid(), 'lakehouse'));

drop policy if exists catalog_registry_insert_perm on lakehouse.catalog_registry;
create policy catalog_registry_insert_perm on lakehouse.catalog_registry
  for insert to authenticated
  with check (
    iam.has_permission(auth.uid(), 'lakehouse')
    and created_by = (select auth.uid())
  );

drop policy if exists catalog_registry_update_perm on lakehouse.catalog_registry;
create policy catalog_registry_update_perm on lakehouse.catalog_registry
  for update to authenticated
  using (iam.has_permission(auth.uid(), 'lakehouse'))
  with check (iam.has_permission(auth.uid(), 'lakehouse'));

-- Suppression d'un catalogue : action irréversible, réservée aux
-- administrateurs (confirmation + ressaisie du nom côté UI).
drop policy if exists catalog_registry_delete_admin on lakehouse.catalog_registry;
create policy catalog_registry_delete_admin on lakehouse.catalog_registry
  for delete to authenticated
  using (iam.has_permission(auth.uid(), 'admin.users'));

-- Le mapping rôle -> catalogue n'est pas sensible (aucune donnée
-- utilisateur) : lisible par les authentifiés pour filtrer les sources des
-- agents ; les écritures passent par le client service (aucune politique).
drop policy if exists catalog_access_select on lakehouse.catalog_access;
create policy catalog_access_select on lakehouse.catalog_access
  for select to authenticated
  using (true);

drop policy if exists query_history_select_own on lakehouse.query_history;
create policy query_history_select_own on lakehouse.query_history
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists query_history_insert_own on lakehouse.query_history;
create policy query_history_insert_own on lakehouse.query_history
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop trigger if exists touch_catalog_registry on lakehouse.catalog_registry;
create trigger touch_catalog_registry before update on lakehouse.catalog_registry
  for each row execute function iam.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 7. connectors — pipelines ELT (dlt) et exécutions
-- ---------------------------------------------------------------------------

create table if not exists connectors.pipelines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  source_type text not null,
  source_config jsonb not null default '{}',
  -- Credentials chiffrés côté serveur (AES-256-GCM, clé hors base) ;
  -- jamais renvoyés au client ni loggés (AGENTS.md §12).
  credentials_encrypted text,
  selected_tables text[] not null default '{}',
  write_mode text not null default 'incremental'
    check (write_mode in ('incremental', 'replace')),
  cron text not null default '',
  destination_catalog text not null,
  -- Schéma (namespace) de destination dans le catalogue lakehouse.
  destination_schema text,
  status text not null default 'active' check (status in ('active', 'inactive', 'error')),
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pipelines_owner_idx on connectors.pipelines (owner_id);
-- Colonne ajoutée après la première version du schéma (idempotent).
alter table connectors.pipelines
  add column if not exists destination_schema text;

create table if not exists connectors.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references connectors.pipelines (id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'success', 'error')),
  -- Origine du run : 'creation' (première exécution à l'enregistrement),
  -- 'manual' (bouton Lancer), 'schedule' (CRON ordonnanceur dlt).
  trigger text not null default 'manual'
    check (trigger in ('creation', 'manual', 'schedule')),
  message text,
  -- Queue du journal d'exécution en cas d'erreur (jamais de secret dedans).
  log text,
  rows_loaded integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists pipeline_runs_pipeline_idx on connectors.pipeline_runs (pipeline_id, started_at desc);
-- Évolution idempotente des installations existantes : statut 'queued'
-- (file d'attente de l'ordonnanceur dlt) + colonnes trigger/log.
alter table connectors.pipeline_runs
  drop constraint if exists pipeline_runs_status_check;
alter table connectors.pipeline_runs
  add constraint pipeline_runs_status_check
  check (status in ('queued', 'running', 'success', 'error'));
alter table connectors.pipeline_runs
  add column if not exists trigger text not null default 'manual'
    check (trigger in ('creation', 'manual', 'schedule'));
alter table connectors.pipeline_runs
  add column if not exists log text;

alter table connectors.pipelines enable row level security;
alter table connectors.pipeline_runs enable row level security;

drop policy if exists pipelines_select_perm on connectors.pipelines;
create policy pipelines_select_perm on connectors.pipelines
  for select to authenticated
  using (iam.has_permission(auth.uid(), 'connectors'));

drop policy if exists pipelines_insert_own on connectors.pipelines;
create policy pipelines_insert_own on connectors.pipelines
  for insert to authenticated
  with check (
    iam.has_permission(auth.uid(), 'connectors')
    and owner_id = (select auth.uid())
  );

drop policy if exists pipelines_update_own_or_admin on connectors.pipelines;
create policy pipelines_update_own_or_admin on connectors.pipelines
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    or iam.has_permission(auth.uid(), 'admin.users')
  )
  with check (
    owner_id = (select auth.uid())
    or iam.has_permission(auth.uid(), 'admin.users')
  );

drop policy if exists pipelines_delete_own_or_admin on connectors.pipelines;
create policy pipelines_delete_own_or_admin on connectors.pipelines
  for delete to authenticated
  using (
    owner_id = (select auth.uid())
    or iam.has_permission(auth.uid(), 'admin.users')
  );

drop policy if exists pipeline_runs_select_perm on connectors.pipeline_runs;
create policy pipeline_runs_select_perm on connectors.pipeline_runs
  for select to authenticated
  using (iam.has_permission(auth.uid(), 'connectors'));

drop policy if exists pipeline_runs_insert_own on connectors.pipeline_runs;
create policy pipeline_runs_insert_own on connectors.pipeline_runs
  for insert to authenticated
  with check (
    exists (
      select 1 from connectors.pipelines p
       where p.id = pipeline_runs.pipeline_id
         and (p.owner_id = auth.uid()
              or iam.has_permission(auth.uid(), 'admin.users'))
    )
  );

drop trigger if exists touch_pipelines on connectors.pipelines;
create trigger touch_pipelines before update on connectors.pipelines
  for each row execute function iam.touch_updated_at();

-- Rôle applicatif du moteur ELT (apps/dlt) : l'ordonnanceur et les conteneurs
-- de run lisent les pipelines, insèrent les runs ordonnancés (CRON) et
-- écrivent leurs résultats. Rôle créé par apps/dlt/sql/01-dlt-role.sql (mot
-- de passe dans le .env local, jamais commité) ; les politiques ne sont
-- posées que si le rôle existe (le schéma reste applicable sans apps/dlt).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'parus_dlt') then
    drop policy if exists pipelines_select_dlt on connectors.pipelines;
    create policy pipelines_select_dlt on connectors.pipelines
      for select to parus_dlt using (true);

    drop policy if exists pipelines_update_dlt on connectors.pipelines;
    create policy pipelines_update_dlt on connectors.pipelines
      for update to parus_dlt using (true) with check (true);

    drop policy if exists pipeline_runs_select_dlt on connectors.pipeline_runs;
    create policy pipeline_runs_select_dlt on connectors.pipeline_runs
      for select to parus_dlt using (true);

    drop policy if exists pipeline_runs_insert_dlt on connectors.pipeline_runs;
    create policy pipeline_runs_insert_dlt on connectors.pipeline_runs
      for insert to parus_dlt with check (true);

    drop policy if exists pipeline_runs_update_dlt on connectors.pipeline_runs;
    create policy pipeline_runs_update_dlt on connectors.pipeline_runs
      for update to parus_dlt using (true) with check (true);
  else
    raise notice 'rôle parus_dlt absent : politiques dlt non posées (lancer apps/dlt/setup.sh puis réappliquer ce script)';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 8. admin — modèles LLM propriétaires et serveurs locaux
-- ---------------------------------------------------------------------------

-- Clés API des modèles propriétaires : chiffrées côté serveur
-- (AES-256-GCM), jamais renvoyées au client (AGENTS.md §11). Aucune
-- politique SELECT : la liste passe par admin.list_proprietary_models().
create table if not exists admin.proprietary_models (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('openai', 'anthropic', 'mistral', 'custom')),
  model text not null,
  api_key_encrypted text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (provider, model)
);

create table if not exists admin.servers (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('s3', 'llm')),
  name text not null,
  server_type text not null,
  url text not null,
  status text not null default 'disconnected' check (status in ('connected', 'disconnected')),
  last_tested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table admin.proprietary_models enable row level security;
alter table admin.servers enable row level security;

-- Liste publique (sans clé) des modèles propriétaires : callable par tout
-- authentifié disposant de la permission agents (formulaire de création
-- d'agent). SECURITY DEFINER dans un schéma non exposé à l'anonyme.
create or replace function admin.list_proprietary_models()
returns table (id uuid, provider text, model text, created_at timestamptz)
language sql
stable
security definer
set search_path = admin, pg_catalog
as $$
  select m.id, m.provider, m.model, m.created_at
    from admin.proprietary_models m
   where iam.has_permission(auth.uid(), 'agents')
   order by m.provider, m.model;
$$;

revoke all on function admin.list_proprietary_models() from public;
grant execute on function admin.list_proprietary_models() to authenticated;

drop policy if exists servers_select_perm on admin.servers;
create policy servers_select_perm on admin.servers
  for select to authenticated
  using (iam.has_permission(auth.uid(), 'admin.servers'));

drop trigger if exists touch_servers on admin.servers;
create trigger touch_servers before update on admin.servers
  for each row execute function iam.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 9. support — tickets
-- ---------------------------------------------------------------------------
create table if not exists support.tickets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tickets_owner_idx on support.tickets (owner_id, created_at desc);

alter table support.tickets enable row level security;

drop policy if exists tickets_select_own_or_admin on support.tickets;
create policy tickets_select_own_or_admin on support.tickets
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or iam.has_permission(auth.uid(), 'admin.users')
  );

drop policy if exists tickets_insert_own on support.tickets;
create policy tickets_insert_own on support.tickets
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists tickets_update_admin on support.tickets;
create policy tickets_update_admin on support.tickets
  for update to authenticated
  using (iam.has_permission(auth.uid(), 'admin.users'))
  with check (iam.has_permission(auth.uid(), 'admin.users'));

drop trigger if exists touch_tickets on support.tickets;
create trigger touch_tickets before update on support.tickets
  for each row execute function iam.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 10. Droits fins par table (principe du moindre privilège)
-- ---------------------------------------------------------------------------

grant select, insert, update on iam.user_profiles to authenticated;
grant select, insert, update, delete on iam.roles to authenticated;
grant select, insert, delete on iam.user_roles to authenticated;
grant select, insert, update, delete on iam.user_active_role to authenticated;

grant select, insert, update, delete on agents.agents to authenticated;
grant select, insert, update, delete on agents.agent_sources to authenticated;

grant select, insert, update, delete on chat.conversations to authenticated;
grant select, insert, delete on chat.messages to authenticated;

grant select, insert, update, delete on lakehouse.catalog_registry to authenticated;
grant select on lakehouse.catalog_access to authenticated;
grant select, insert on lakehouse.query_history to authenticated;

grant select, insert, update, delete on connectors.pipelines to authenticated;
grant select, insert on connectors.pipeline_runs to authenticated;

grant select on admin.servers to authenticated;

grant select, insert, update, delete on support.tickets to authenticated;

-- Le client administrateur (clé service_role, serveur uniquement) accède à
-- tout ; il contourne la RLS (BYPASSRLS) mais a besoin des droits.
grant usage on schema iam, agents, chat, lakehouse, connectors, admin, support
  to service_role;
grant select, insert, update, delete on all tables in schema
  iam, agents, chat, lakehouse, connectors, admin, support
  to service_role;
grant execute on function iam.has_permission(uuid, text) to service_role;
grant execute on function iam.active_role_id(uuid) to service_role;
grant execute on function admin.list_proprietary_models() to service_role;

-- ---------------------------------------------------------------------------
-- 11. Bootstrap utilisateur (trigger sur auth.users)
-- ---------------------------------------------------------------------------

-- Premier utilisateur créé = administrateur ; les suivants = profil métier.
create or replace function iam.on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = iam, pg_catalog
as $$
declare
  v_role_key text;
  v_role_id uuid;
begin
  if exists (select 1 from iam.user_profiles) then
    v_role_key := 'metier';
  else
    v_role_key := 'admin';
  end if;

  insert into iam.user_profiles (id) values (new.id)
    on conflict (id) do nothing;

  select r.id into v_role_id from iam.roles r where r.key = v_role_key;
  if v_role_id is not null then
    insert into iam.user_roles (user_id, role_id) values (new.id, v_role_id)
      on conflict (user_id, role_id) do nothing;
    insert into iam.user_active_role (user_id, role_id) values (new.id, v_role_id)
      on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function iam.on_auth_user_created() from public;
grant execute on function iam.on_auth_user_created()
  to supabase_auth_admin, service_role, supabase_admin;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function iam.on_auth_user_created();

-- ---------------------------------------------------------------------------
-- 12. Seed : rôles système (spec §Rôles et Permissions)
-- ---------------------------------------------------------------------------

insert into iam.roles (key, name, description, permissions, is_system) values
  ('admin', 'Administrateur',
   'Accès complet à toutes les fonctionnalités de la plateforme.',
   array[
     'chat', 'agents', 'lakehouse', 'connectors',
     'admin.users', 'admin.roles', 'admin.servers', 'admin.billing', 'support'
   ], true),
  ('technique', 'Profil Technique',
   'Accès au chat, aux agents IA et au Data Lakehouse.',
   array['chat', 'agents', 'lakehouse', 'connectors', 'support'], true),
  ('metier', 'Profil Métier',
   'Accès au chat avec les agents IA autorisés.',
   array['chat', 'support'], true)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      permissions = excluded.permissions,
      is_system = excluded.is_system;

-- ---------------------------------------------------------------------------
-- 13. Backfill des utilisateurs existants (premier créé = admin)
-- ---------------------------------------------------------------------------

insert into iam.user_profiles (id)
select u.id from auth.users u
on conflict (id) do nothing;

insert into iam.user_roles (user_id, role_id)
select o.id, r.id
from (
  select id, row_number() over (order by created_at) as rn
  from auth.users
) o
join iam.roles r
  on r.key = case when o.rn = 1 then 'admin' else 'metier' end
on conflict (user_id, role_id) do nothing;

insert into iam.user_active_role (user_id, role_id)
select distinct on (ur.user_id) ur.user_id, ur.role_id
from iam.user_roles ur
where not exists (
  select 1 from iam.user_active_role uar where uar.user_id = ur.user_id
)
order by ur.user_id, ur.granted_at
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 14. Métriques d'usage (facturation) et seed des serveurs locaux
-- ---------------------------------------------------------------------------

-- Agrégats d'usage pour la section Facturation (spec §Administration). La
-- fonction vérifie la permission admin.billing ; sans elle, aucune ligne.
create or replace function admin.usage_metrics()
returns table (
  llm_duration_ms bigint,
  llm_tokens bigint,
  trino_queries bigint,
  active_pipelines bigint,
  conversations bigint
)
language sql
stable
security definer
set search_path = admin, pg_catalog
as $$
  select
    (select coalesce(sum((m.metadata->>'duration_ms')::bigint), 0)
       from chat.messages m where m.role = 'assistant'),
    (select coalesce(sum(coalesce((m.metadata->>'prompt_tokens')::bigint, 0)
                        + coalesce((m.metadata->>'eval_tokens')::bigint, 0)), 0)
       from chat.messages m where m.role = 'assistant'),
    (select count(*) from lakehouse.query_history),
    (select count(*) from connectors.pipelines where status = 'active'),
    (select count(*) from chat.conversations)
  where iam.has_permission(auth.uid(), 'admin.billing');
$$;

revoke all on function admin.usage_metrics() from public;
grant execute on function admin.usage_metrics() to authenticated;
grant execute on function admin.usage_metrics() to service_role;

-- Serveurs locaux détectés de la stack (statut initial : connectés depuis
-- les services internes ; le bouton « Test » de l'app revalide à la demande).
-- Idempotent sur le nom (pas de contrainte unique : garde NOT EXISTS).
insert into admin.servers (kind, name, server_type, url, status)
select x.kind, x.name, x.server_type, x.url, x.status
from (
  values
    ('s3', 'RustFS (stack Supabase)', 'rustfs',
     'http://rustfs:9000', 'connected'),
    ('llm', 'Ollama (local)', 'ollama',
     'http://localhost:11434', 'connected')
) as x(kind, name, server_type, url, status)
where not exists (
  select 1 from admin.servers s where s.name = x.name
);

commit;
