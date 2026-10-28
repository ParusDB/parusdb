-- ============================================================================
-- ParusDB — Schéma applicatif (bases transactionnelles)
-- ============================================================================
-- Fichier SQL versionné et idempotent (convention AGENTS.md §9 : toute
-- modification DDL passe par un fichier SQL commité, jamais via Studio).
--
-- Répartition par schéma métier :
--   iam        — comptes, rôles applicatifs, grants RBAC, rôle actif,
--                utilisateurs applicatifs (outils data)
--   agents     — agents IA et leurs sources de connaissances
--   chat       — conversations, messages, partages de conversation
--   lakehouse  — registre des catalogues, historique SQL
--   connectors — pipelines ELT (dlt) et leurs exécutions
--   admin      — fournisseurs LLM externes (clés API chiffrées)
--
-- RBAC (docs/functional/rbac_refonte.md) : modèle à grants calqué sur Apache
-- Polaris. Les ressources sont les catalogues, les agents IA et les
-- pipelines ; les privilèges read/write/manage sont hiérarchiques
-- (manage ⊇ write ⊇ read). Le rôle qui crée un objet en devient propriétaire
-- (owner_role_id) ; le rôle actif du compte détermine tous les accès ; le
-- rôle `admin` hérite de tout ; `public` (nouveaux comptes) n'a aucun accès.
-- Les conversations appartiennent au compte (pas au rôle) et peuvent être
-- partagées en lecture seule à un rôle (chat.conversation_shares).
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

-- Les schémas métier ne sont jamais exposés à l'anonyme ; les requêtes
-- authentifiées passent par PostgREST (rôle `authenticated`) et sont filtrées
-- par RLS ci-dessous.
revoke all on schema iam, agents, chat, lakehouse, connectors, admin
  from anon;
grant usage on schema iam, agents, chat, lakehouse, connectors, admin
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
-- 3. iam — comptes, rôles, grants RBAC, rôle actif, utilisateurs applicatifs
-- ---------------------------------------------------------------------------

create table if not exists iam.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text,
  last_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rôles applicatifs (groupements de comptes) : le RBAC ne vit plus dans une
-- colonne de permissions statiques mais dans iam.grants + la propriété des
-- objets (owner_role_id). `admin` (hérite de tout) et `public` (aucun accès,
-- attribué aux nouveaux comptes) sont système.
create table if not exists iam.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
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

-- Grants RBAC : privilèges d'un rôle sur une ressource. resource_id est le
-- nom du catalogue, ou l'identifiant (uuid) de l'agent/pipeline. Les
-- privilèges sont hiérarchiques : manage ⊇ write ⊇ read (iam.privilege_rank).
create table if not exists iam.grants (
  role_id uuid not null references iam.roles (id) on delete cascade,
  resource_type text not null check (resource_type in ('catalog', 'agent', 'pipeline')),
  resource_id text not null,
  privileges text[] not null default '{}' check (privileges @> '{}'::text[]),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (role_id, resource_type, resource_id),
  constraint grants_privileges_format
    check (privileges <@ array['read', 'write', 'manage']::text[])
);
create index if not exists grants_resource_idx on iam.grants (resource_type, resource_id);

-- Utilisateurs applicatifs (comptes service pour les outils data : dbt,
-- Power BI, Airbyte…) : miroir applicatif d'un principal Polaris. Le
-- clientSecret n'est JAMAIS stocké ici — affiché une seule fois à la
-- création/réinitialisation. role_id détermine les catalogues répliqués en
-- grants Polaris réels.
create table if not exists iam.app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  note text,
  role_id uuid not null references iam.roles (id) on delete restrict,
  polaris_client_id text not null,
  credentials_rotated_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists app_users_role_id_idx on iam.app_users (role_id);

-- Colonnes de propriété par rôle (RBAC refonte) : ajoutées tôt car les
-- fonctions d'autorisation ci-dessous les référencent à leur création (les
-- fonctions SQL sont validées à la création). Sur installation existante la
-- colonne est ajoutée ici ; sur installation fraîche les tables la portent
-- dès leur création et ces instructions sont sans effet.
alter table if exists agents.agents
  add column if not exists owner_role_id uuid references iam.roles (id)
  on delete restrict;
alter table if exists connectors.pipelines
  add column if not exists owner_role_id uuid references iam.roles (id)
  on delete restrict;
alter table if exists lakehouse.catalog_registry
  add column if not exists owner_role_id uuid references iam.roles (id)
  on delete restrict;

-- Rôle actif et fonctions d'autorisation : fondation du RBAC applicatif.
-- Définis après les tables iam (les fonctions SQL standard sont validées à la
-- création). Les décisions d'autorisation ne s'appuient JAMAIS sur
-- raw_user_meta_data (éditable par l'utilisateur) — tout vit dans ces
-- tables (AGENTS.md §9).

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

-- Rang d'un privilège (hiérarchie read < write < manage). Toute autre valeur
-- est irrecevable (99) : un privilège inconnu ne peut jamais être satisfait.
create or replace function iam.privilege_rank(p_privilege text)
returns int
language sql
immutable
strict
as $$
  select case p_privilege
           when 'read' then 1
           when 'write' then 2
           when 'manage' then 3
           else 99
         end;
$$;

revoke all on function iam.privilege_rank(text) from public;

-- Le compte porte le rôle système `admin` (indépendamment du rôle actif :
-- l'administration est une capacité du compte, pas un périmètre de données).
create or replace function iam.is_admin(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = iam, pg_catalog
as $$
  select exists (
    select 1
      from iam.user_roles ur
      join iam.roles r on r.id = ur.role_id
     where ur.user_id = p_user
       and r.key = 'admin'
  );
$$;

-- Décision d'accès central : vrai si le rôle ACTIF du compte est admin
-- (hérite de tout), propriétaire de la ressource (owner_role_id), ou bénéficie
-- d'un grant couvrant le privilège demandé (hiérarchie des privilèges).
create or replace function iam.has_grant(
  p_user uuid,
  p_resource_type text,
  p_resource_id text,
  p_privilege text
)
returns boolean
language sql
stable
security definer
set search_path = iam, pg_catalog
as $$
  select iam.is_admin(p_user)
  or (
    iam.active_role_id(p_user) is not null
    and (
      case p_resource_type
        when 'catalog' then exists (
          select 1
            from lakehouse.catalog_registry cr
           where cr.catalog_name = p_resource_id
             and cr.owner_role_id = iam.active_role_id(p_user)
        )
        when 'agent' then exists (
          select 1
            from agents.agents a
           where a.id::text = p_resource_id
             and a.owner_role_id = iam.active_role_id(p_user)
        )
        when 'pipeline' then exists (
          select 1
            from connectors.pipelines p
           where p.id::text = p_resource_id
             and p.owner_role_id = iam.active_role_id(p_user)
        )
        else false
      end
      or exists (
        select 1
          from iam.grants g
          cross join unnest(g.privileges) gp
         where g.role_id = iam.active_role_id(p_user)
           and g.resource_type = p_resource_type
           and g.resource_id = p_resource_id
           and iam.privilege_rank(gp) >= iam.privilege_rank(p_privilege)
      )
    )
  );
$$;

revoke all on function iam.is_admin(uuid) from public;
grant execute on function iam.is_admin(uuid) to authenticated;
revoke all on function iam.has_grant(uuid, text, text, text) from public;
grant execute on function iam.has_grant(uuid, text, text, text) to authenticated;
revoke all on function iam.active_role_id(uuid) from public;
grant execute on function iam.active_role_id(uuid) to authenticated;

alter table iam.user_profiles enable row level security;
alter table iam.roles enable row level security;
alter table iam.user_roles enable row level security;
alter table iam.user_active_role enable row level security;
alter table iam.grants enable row level security;
alter table iam.app_users enable row level security;

drop policy if exists profiles_select_own_or_admin on iam.user_profiles;
create policy profiles_select_own_or_admin on iam.user_profiles
  for select to authenticated
  using (id = (select auth.uid()) or iam.is_admin((select auth.uid())));

drop policy if exists profiles_insert_own on iam.user_profiles;
create policy profiles_insert_own on iam.user_profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists profiles_update_own_or_admin on iam.user_profiles;
create policy profiles_update_own_or_admin on iam.user_profiles
  for update to authenticated
  using (id = (select auth.uid()) or iam.is_admin((select auth.uid())))
  with check (id = (select auth.uid()) or iam.is_admin((select auth.uid())));

-- Les rôles ne sont pas sensibles (ni grants ni membres) : lisibles par tous
-- les authentifiés (sélecteur de rôle actif, formulaires).
drop policy if exists roles_select_all on iam.roles;
create policy roles_select_all on iam.roles
  for select to authenticated
  using (true);

drop policy if exists roles_admin_write on iam.roles;
create policy roles_admin_write on iam.roles
  for all to authenticated
  using (iam.is_admin((select auth.uid())))
  with check (iam.is_admin((select auth.uid())));

drop policy if exists user_roles_select_own_or_admin on iam.user_roles;
create policy user_roles_select_own_or_admin on iam.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or iam.is_admin((select auth.uid())));

drop policy if exists user_roles_admin_write on iam.user_roles;
create policy user_roles_admin_write on iam.user_roles
  for all to authenticated
  using (iam.is_admin((select auth.uid())))
  with check (iam.is_admin((select auth.uid())));

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

-- Grants : chaque compte lit les grants de son rôle actif (filtrer les
-- catalogues/agents/pipelines accessibles dans l'UI) ; l'admin lit et écrit
-- tout (éditeur de rôles /admin/roles).
drop policy if exists grants_select_own_or_admin on iam.grants;
create policy grants_select_own_or_admin on iam.grants
  for select to authenticated
  using (
    role_id = iam.active_role_id((select auth.uid()))
    or iam.is_admin((select auth.uid()))
  );

drop policy if exists grants_admin_write on iam.grants;
create policy grants_admin_write on iam.grants
  for all to authenticated
  using (iam.is_admin((select auth.uid())))
  with check (iam.is_admin((select auth.uid())));

-- Utilisateurs applicatifs : administration uniquement (le clientSecret ne
-- vit pas ici, seul le clientId — identifiant public — est exposé).
drop policy if exists app_users_admin_all on iam.app_users;
create policy app_users_admin_all on iam.app_users
  for all to authenticated
  using (iam.is_admin((select auth.uid())))
  with check (iam.is_admin((select auth.uid())));

drop trigger if exists touch_user_profiles on iam.user_profiles;
create trigger touch_user_profiles before update on iam.user_profiles
  for each row execute function iam.touch_updated_at();
drop trigger if exists touch_roles on iam.roles;
create trigger touch_roles before update on iam.roles
  for each row execute function iam.touch_updated_at();
drop trigger if exists touch_user_active_role on iam.user_active_role;
create trigger touch_user_active_role before update on iam.user_active_role
  for each row execute function iam.touch_updated_at();
drop trigger if exists touch_grants on iam.grants;
create trigger touch_grants before update on iam.grants
  for each row execute function iam.touch_updated_at();
drop trigger if exists touch_app_users on iam.app_users;
create trigger touch_app_users before update on iam.app_users
  for each row execute function iam.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. agents — agents IA et sources de connaissances
-- ---------------------------------------------------------------------------

create table if not exists agents.agents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
-- Source du modèle : 'ollama' (serveur d'inférence local embarqué, réservé)
-- ou identifiant d'un fournisseur externe (admin.providers). Contrainte
-- relâchée en fin de fichier (migration des anciens libellés openai/
-- anthropic/mistral/custom vers les identifiants de fournisseurs).
  model_provider text not null default 'ollama',
  model_id text not null,
  system_prompt text not null default '',
-- Propriété par rôle : le rôle actif qui crée l'agent en devient
-- propriétaire ; owner_id reste la traçabilité « créé par ».
  owner_role_id uuid references iam.roles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agents_owner_id_idx on agents.agents (owner_id);
create index if not exists agents_owner_role_id_idx on agents.agents (owner_role_id);

-- Sources de connaissances d'un agent : catalogues du lakehouse autorisés au
-- rôle actif du créateur au moment de la création (spec §Agents IA).
create table if not exists agents.agent_sources (
  agent_id uuid not null references agents.agents (id) on delete cascade,
  source_type text not null default 'catalog' check (source_type in ('catalog')),
  source_name text not null,
  primary key (agent_id, source_type, source_name)
);
create index if not exists agent_sources_agent_id_idx on agents.agent_sources (agent_id);

alter table agents.agents enable row level security;
alter table agents.agent_sources enable row level security;

-- Accès aux agents : lecture (voir/discuter), écriture (modifier les sources
-- et l'agent), gestion (supprimer) — évalués sur le rôle actif du compte
-- (propriété + grants, iam.has_grant).
drop policy if exists agents_select_perm on agents.agents;
create policy agents_select_perm on agents.agents
  for select to authenticated
  using (iam.has_grant((select auth.uid()), 'agent', id::text, 'read'));

drop policy if exists agents_insert_own on agents.agents;
create policy agents_insert_own on agents.agents
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and owner_role_id = iam.active_role_id((select auth.uid()))
  );

drop policy if exists agents_update_own on agents.agents;
create policy agents_update_own on agents.agents
  for update to authenticated
  using (iam.has_grant((select auth.uid()), 'agent', id::text, 'write'))
  with check (iam.has_grant((select auth.uid()), 'agent', id::text, 'write'));

drop policy if exists agents_delete_own on agents.agents;
create policy agents_delete_own on agents.agents
  for delete to authenticated
  using (iam.has_grant((select auth.uid()), 'agent', id::text, 'manage'));

drop policy if exists agent_sources_select_perm on agents.agent_sources;
create policy agent_sources_select_perm on agents.agent_sources
  for select to authenticated
  using (
    exists (
      select 1 from agents.agents a
       where a.id = agent_sources.agent_id
         and iam.has_grant((select auth.uid()), 'agent', a.id::text, 'read')
    )
  );

drop policy if exists agent_sources_write_own on agents.agent_sources;
create policy agent_sources_write_own on agents.agent_sources
  for all to authenticated
  using (
    exists (
      select 1 from agents.agents a
       where a.id = agent_sources.agent_id
         and iam.has_grant((select auth.uid()), 'agent', a.id::text, 'write')
    )
  )
  with check (
    exists (
      select 1 from agents.agents a
       where a.id = agent_sources.agent_id
         and iam.has_grant((select auth.uid()), 'agent', a.id::text, 'write')
    )
  );

drop trigger if exists touch_agents on agents.agents;
create trigger touch_agents before update on agents.agents
  for each row execute function iam.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. chat — conversations, messages, partages
-- ---------------------------------------------------------------------------

-- L'agent est immuable après création de la conversation (spec §Chat) : pas de
-- modification possible côté app, et l'agent ne peut pas être supprimé tant
-- que des conversations y font référence (on delete restrict).
-- Les conversations appartiennent au COMPTE (pas au rôle) : le propriétaire
-- peut partager l'accès en lecture seule aux comptes partageant l'un de ses
-- rôles (chat.conversation_shares).
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

-- Partage d'une conversation à un rôle : lecture seule pour les membres du
-- rôle (aucune écriture de message, pas de renommage). Accès révocable par
-- le propriétaire. Indépendant de iam.grants : les chats ne sont pas une
-- ressource RBAC, ils restent personnels.
create table if not exists chat.conversation_shares (
  conversation_id uuid not null references chat.conversations (id) on delete cascade,
  role_id uuid not null references iam.roles (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (conversation_id, role_id)
);
create index if not exists conversation_shares_role_idx
  on chat.conversation_shares (role_id);

-- Vérification de propriété d'une conversation pour les partages :
-- SECURITY DEFINER (schéma non exposé à l'anonyme) — les politiques
-- INSERT/DELETE des partages ne peuvent pas référencer chat.conversations
-- directement sans créer une récursion de politiques (shares → conversations
-- → shares).
create or replace function chat.can_manage_share(p_conversation_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = chat, pg_catalog
as $$
  select exists (
    select 1
      from chat.conversations c
     where c.id = p_conversation_id
       and (c.owner_id = p_user or iam.is_admin(p_user))
  );
$$;

revoke all on function chat.can_manage_share(uuid, uuid) from public;
grant execute on function chat.can_manage_share(uuid, uuid) to authenticated;

alter table chat.conversations enable row level security;
alter table chat.messages enable row level security;
alter table chat.conversation_shares enable row level security;

-- Les membres du rôle bénéficiaire voient la ligne de partage de leur rôle
-- actif ; le propriétaire voit celles qu'il a accordées ; l'admin voit tout.
-- (Pas de jointure vers conversations ici : la récursion RLS est interdite.)
drop policy if exists conversation_shares_select on chat.conversation_shares;
create policy conversation_shares_select on chat.conversation_shares
  for select to authenticated
  using (
    granted_by = (select auth.uid())
    or role_id = iam.active_role_id((select auth.uid()))
    or iam.is_admin((select auth.uid()))
  );

drop policy if exists conversation_shares_owner_write on chat.conversation_shares;
drop policy if exists conversation_shares_owner_insert on chat.conversation_shares;
drop policy if exists conversation_shares_owner_delete on chat.conversation_shares;
create policy conversation_shares_owner_insert on chat.conversation_shares
  for insert to authenticated
  with check (chat.can_manage_share(conversation_id, (select auth.uid())));

create policy conversation_shares_owner_delete on chat.conversation_shares
  for delete to authenticated
  using (chat.can_manage_share(conversation_id, (select auth.uid())));

-- Conversations : le propriétaire a tous les droits ; les membres d'un rôle
-- bénéficiaire (rôle actif) et l'admin n'ont que la lecture.
drop policy if exists conversations_owner_all on chat.conversations;
drop policy if exists conversations_select_visible on chat.conversations;
drop policy if exists conversations_insert_own on chat.conversations;
drop policy if exists conversations_update_own on chat.conversations;
drop policy if exists conversations_delete_own on chat.conversations;
create policy conversations_select_visible on chat.conversations
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or iam.is_admin((select auth.uid()))
    or exists (
      select 1 from chat.conversation_shares s
       where s.conversation_id = conversations.id
         and s.role_id = iam.active_role_id((select auth.uid()))
    )
  );

create policy conversations_insert_own on chat.conversations
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and iam.has_grant((select auth.uid()), 'agent', agent_id::text, 'read')
  );

create policy conversations_update_own on chat.conversations
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy conversations_delete_own on chat.conversations
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Messages : lecture pour le propriétaire, les rôles bénéficiaires (lecture
-- seule) et l'admin ; écriture/suppression réservées au propriétaire.
drop policy if exists messages_select_own on chat.messages;
drop policy if exists messages_insert_own on chat.messages;
drop policy if exists messages_delete_own on chat.messages;
drop policy if exists messages_select_visible on chat.messages;
drop policy if exists messages_insert_owner on chat.messages;
drop policy if exists messages_delete_owner on chat.messages;
create policy messages_select_visible on chat.messages
  for select to authenticated
  using (
    exists (
      select 1 from chat.conversations c
       where c.id = messages.conversation_id
         and (
           c.owner_id = (select auth.uid())
           or iam.is_admin((select auth.uid()))
           or exists (
             select 1 from chat.conversation_shares s
              where s.conversation_id = c.id
                and s.role_id = iam.active_role_id((select auth.uid()))
           )
         )
    )
  );

drop policy if exists messages_insert_own on chat.messages;
create policy messages_insert_owner on chat.messages
  for insert to authenticated
  with check (
    exists (
      select 1 from chat.conversations c
       where c.id = messages.conversation_id and c.owner_id = (select auth.uid())
    )
  );

drop policy if exists messages_delete_own on chat.messages;
create policy messages_delete_owner on chat.messages
  for delete to authenticated
  using (
    exists (
      select 1 from chat.conversations c
       where c.id = messages.conversation_id and c.owner_id = (select auth.uid())
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
drop policy if exists stream_events_select_visible on chat.stream_events;
drop policy if exists stream_events_owner_write on chat.stream_events;
drop policy if exists stream_events_owner_delete on chat.stream_events;
create policy stream_events_select_visible on chat.stream_events
  for select to authenticated
  using (
    exists (
      select 1 from chat.conversations c
       where c.id = stream_events.conversation_id
         and (
           c.owner_id = (select auth.uid())
           or iam.is_admin((select auth.uid()))
           or exists (
             select 1 from chat.conversation_shares s
              where s.conversation_id = c.id
                and s.role_id = iam.active_role_id((select auth.uid()))
           )
         )
    )
  );

create policy stream_events_owner_write on chat.stream_events
  for insert to authenticated
  with check (
    exists (
      select 1 from chat.conversations c
       where c.id = stream_events.conversation_id and c.owner_id = (select auth.uid())
    )
  );

create policy stream_events_owner_delete on chat.stream_events
  for delete to authenticated
  using (
    exists (
      select 1 from chat.conversations c
       where c.id = stream_events.conversation_id and c.owner_id = (select auth.uid())
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
end
$$;

-- ---------------------------------------------------------------------------
-- 6. lakehouse — registre des catalogues, historique SQL
-- ---------------------------------------------------------------------------
-- Polaris reste la source de vérité des catalogues (métadonnées Iceberg) ;
-- ce registre ne conserve que la description applicative et la propriété par
-- rôle. L'accès par rôle vit dans iam.grants (resource_type 'catalog').

create table if not exists lakehouse.catalog_registry (
  catalog_name text primary key,
  description text,
  created_by uuid references auth.users (id) on delete set null,
-- Propriété par rôle : le rôle actif qui crée le catalogue en devient
-- propriétaire ; created_by reste la traçabilité « créé par ».
  owner_role_id uuid references iam.roles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists catalog_registry_owner_role_idx
  on lakehouse.catalog_registry (owner_role_id);

-- L'ancien mapping rôle → catalogue (lakehouse.catalog_access) est remplacé
-- par iam.grants : nettoyage idempotent des installations existantes.
drop table if exists lakehouse.catalog_access;

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
alter table lakehouse.query_history enable row level security;

-- Accès aux catalogues : lecture (voir + requêter), écriture (créer/modifier
-- des objets, être destination d'ingestion), gestion (modifier/supprimer le
-- catalogue) — propriété + grants sur le rôle actif.
drop policy if exists catalog_registry_select_perm on lakehouse.catalog_registry;
create policy catalog_registry_select_perm on lakehouse.catalog_registry
  for select to authenticated
  using (iam.has_grant((select auth.uid()), 'catalog', catalog_name, 'read'));

drop policy if exists catalog_registry_insert_perm on lakehouse.catalog_registry;
create policy catalog_registry_insert_perm on lakehouse.catalog_registry
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and owner_role_id = iam.active_role_id((select auth.uid()))
  );

drop policy if exists catalog_registry_update_perm on lakehouse.catalog_registry;
create policy catalog_registry_update_perm on lakehouse.catalog_registry
  for update to authenticated
  using (iam.has_grant((select auth.uid()), 'catalog', catalog_name, 'write'))
  with check (iam.has_grant((select auth.uid()), 'catalog', catalog_name, 'write'));

drop policy if exists catalog_registry_delete_admin on lakehouse.catalog_registry;
drop policy if exists catalog_registry_delete_manage on lakehouse.catalog_registry;
create policy catalog_registry_delete_manage on lakehouse.catalog_registry
  for delete to authenticated
  using (iam.has_grant((select auth.uid()), 'catalog', catalog_name, 'manage'));

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
-- Propriété par rôle : le pipeline appartient au rôle actif qui l'a créé ;
-- owner_id reste la traçabilité « créé par ».
  owner_role_id uuid references iam.roles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pipelines_owner_idx on connectors.pipelines (owner_id);
create index if not exists pipelines_owner_role_id_idx on connectors.pipelines (owner_role_id);
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

-- Accès aux pipelines : le rôle actif propriétaire ou bénéficiaire d'un
-- grant (read : voir/statuts/historique ; write : modifier/lancer/désactiver ;
-- manage : supprimer). La destination d'ingestion doit être un catalogue où
-- le rôle actif dispose du privilège write.
drop policy if exists pipelines_select_perm on connectors.pipelines;
create policy pipelines_select_perm on connectors.pipelines
  for select to authenticated
  using (iam.has_grant((select auth.uid()), 'pipeline', id::text, 'read'));

drop policy if exists pipelines_insert_own on connectors.pipelines;
create policy pipelines_insert_own on connectors.pipelines
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and owner_role_id = iam.active_role_id((select auth.uid()))
    and iam.has_grant((select auth.uid()), 'catalog', destination_catalog, 'write')
  );

drop policy if exists pipelines_update_own_or_admin on connectors.pipelines;
drop policy if exists pipelines_update_write on connectors.pipelines;
create policy pipelines_update_write on connectors.pipelines
  for update to authenticated
  using (iam.has_grant((select auth.uid()), 'pipeline', id::text, 'write'))
  with check (
    iam.has_grant((select auth.uid()), 'pipeline', id::text, 'write')
    and iam.has_grant((select auth.uid()), 'catalog', destination_catalog, 'write')
  );

drop policy if exists pipelines_delete_own_or_admin on connectors.pipelines;
drop policy if exists pipelines_delete_manage on connectors.pipelines;
create policy pipelines_delete_manage on connectors.pipelines
  for delete to authenticated
  using (iam.has_grant((select auth.uid()), 'pipeline', id::text, 'manage'));

drop policy if exists pipeline_runs_select_perm on connectors.pipeline_runs;
create policy pipeline_runs_select_perm on connectors.pipeline_runs
  for select to authenticated
  using (
    exists (
      select 1 from connectors.pipelines p
       where p.id = pipeline_runs.pipeline_id
         and iam.has_grant((select auth.uid()), 'pipeline', p.id::text, 'read')
    )
  );

drop policy if exists pipeline_runs_insert_own on connectors.pipeline_runs;
create policy pipeline_runs_insert_own on connectors.pipeline_runs
  for insert to authenticated
  with check (
    exists (
      select 1 from connectors.pipelines p
       where p.id = pipeline_runs.pipeline_id
         and iam.has_grant((select auth.uid()), 'pipeline', p.id::text, 'write')
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
-- 8. admin — fournisseurs LLM (clés API chiffrées)
-- ---------------------------------------------------------------------------

-- Fournisseurs externes de modèles LLM, ajoutés en administration par clé
-- API. Ollama (local) est embarqué par ParusDB et n'a pas de ligne ici.
-- Les modèles ne sont plus stockés : ils sont découverts dynamiquement via
-- l'API du fournisseur (AGENTS.md §11). Clé chiffrée AES-256-GCM côté BFF,
-- jamais renvoyée au client. Aucune politique SELECT : la liste passe par
-- admin.list_providers().
create table if not exists admin.providers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  api_kind text not null
    check (api_kind in ('openai', 'anthropic', 'mistral', 'openai_compatible')),
  base_url text,
  api_key_encrypted text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint providers_base_url_required
    check (api_kind <> 'openai_compatible' or base_url is not null)
);

-- Migration depuis l'ancien modèle (un modèle propriétaire = une clé) :
-- un fournisseur par provider historique, première clé rencontrée.
do $$
begin
  if to_regclass('admin.proprietary_models') is not null then
    insert into admin.providers (name, api_kind, api_key_encrypted)
    select
      case m.provider
        when 'openai' then 'OpenAI'
        when 'anthropic' then 'Anthropic'
        when 'mistral' then 'Mistral'
        else initcap(m.provider)
      end,
      case m.provider when 'custom' then 'openai_compatible' else m.provider end,
      (array_agg(m.api_key_encrypted order by m.created_at desc))[1]
    from admin.proprietary_models m
    group by m.provider
    on conflict (name) do nothing;
  end if;
end
$$;

-- Les agents référencent désormais un fournisseur par son identifiant
-- ('ollama' reste réservé au serveur local). Migration best effort des
-- anciens libellés ; idempotent (les UUID déjà migrés ne matchent plus).
update agents.agents a
   set model_provider = p.id::text
  from admin.providers p
 where a.model_provider in ('openai', 'anthropic', 'mistral')
   and p.name = case a.model_provider
                  when 'openai' then 'OpenAI'
                  when 'anthropic' then 'Anthropic'
                  when 'mistral' then 'Mistral'
                end;

-- Contrainte garde-fou : 'ollama' ou un UUID de fournisseur. NOT VALID car
-- d'anciens agents peuvent référencer une source disparue ('custom').
alter table agents.agents
  drop constraint if exists agents_model_provider_check;
alter table agents.agents
  add constraint agents_model_provider_check
  check (
    model_provider = 'ollama'
    or model_provider ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) not valid;

alter table admin.providers enable row level security;

-- Liste publique (sans clé) des fournisseurs : callable par tout authentifié
-- (formulaire de création/édition d'agent — tout compte peut créer un agent,
-- son rôle actif en devient propriétaire). SECURITY DEFINER dans un schéma
-- non exposé à l'anonyme.
create or replace function admin.list_providers()
returns table (id uuid, name text, api_kind text)
language sql
stable
security definer
set search_path = admin, pg_catalog
as $$
  select p.id, p.name, p.api_kind
    from admin.providers p
   order by p.name;
$$;

revoke all on function admin.list_providers() from public;
grant execute on function admin.list_providers() to authenticated;

drop function if exists admin.list_proprietary_models();

drop trigger if exists touch_providers on admin.providers;
create trigger touch_providers before update on admin.providers
  for each row execute function iam.touch_updated_at();

-- L'ancien modèle (serveurs S3/LLM + modèles propriétaires ligne à ligne)
-- est remplacé par les fournisseurs : suppression après migration.
drop table if exists admin.proprietary_models;
drop table if exists admin.servers;

-- ---------------------------------------------------------------------------
-- 9. Suppression des tickets support (brique Support retirée)
-- ---------------------------------------------------------------------------

-- L'ancienne brique Support (page /support, tickets in-app) a été retirée du
-- produit. Nettoyage idempotent des installations existantes : suppression du
-- schéma (tables, index, politiques et trigger partent avec lui).
drop schema if exists support cascade;

-- ---------------------------------------------------------------------------
-- 10. Droits fins par table (principe du moindre privilège)
-- ---------------------------------------------------------------------------

grant select, insert, update on iam.user_profiles to authenticated;
grant select, insert, update, delete on iam.roles to authenticated;
grant select, insert, delete on iam.user_roles to authenticated;
grant select, insert, update, delete on iam.user_active_role to authenticated;
grant select, insert, update, delete on iam.grants to authenticated;
grant select, insert, update, delete on iam.app_users to authenticated;

grant select, insert, update, delete on agents.agents to authenticated;
grant select, insert, update, delete on agents.agent_sources to authenticated;

grant select, insert, update, delete on chat.conversations to authenticated;
grant select, insert, delete on chat.messages to authenticated;
grant select, insert, delete on chat.conversation_shares to authenticated;

grant select, insert, update, delete on lakehouse.catalog_registry to authenticated;
grant select, insert on lakehouse.query_history to authenticated;

grant select, insert, update, delete on connectors.pipelines to authenticated;
grant select, insert on connectors.pipeline_runs to authenticated;

-- Le client administrateur (clé service_role, serveur uniquement) accède à
-- tout ; il contourne la RLS (BYPASSRLS) mais a besoin des droits.
grant usage on schema iam, agents, chat, lakehouse, connectors, admin
  to service_role;
grant select, insert, update, delete on all tables in schema
  iam, agents, chat, lakehouse, connectors, admin
  to service_role;
grant execute on function iam.is_admin(uuid) to service_role;
grant execute on function iam.has_grant(uuid, text, text, text) to service_role;
grant execute on function iam.active_role_id(uuid) to service_role;
grant execute on function chat.can_manage_share(uuid, uuid) to service_role;
grant execute on function admin.list_providers() to service_role;

-- ---------------------------------------------------------------------------
-- 11. Bootstrap utilisateur (trigger sur auth.users)
-- ---------------------------------------------------------------------------

-- Premier utilisateur créé = administrateur ; les suivants = rôle public
-- (aucun accès) : l'admin leur attribue des rôles via /admin/users.
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
    v_role_key := 'public';
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
-- 12. Seed : rôles système (RBAC refonte, docs/functional/rbac_refonte.md)
-- ---------------------------------------------------------------------------

insert into iam.roles (key, name, description, is_system) values
  ('admin', 'Administrateur',
   'Hérite de tous les droits sur toutes les ressources de la plateforme.',
   true),
  ('public', 'Public',
   'Rôle par défaut des nouveaux comptes : aucun accès aux objets. L''administrateur attribue des rôles via /admin/users.',
   true)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      is_system = excluded.is_system;

-- ---------------------------------------------------------------------------
-- 13. Migration RBAC (idempotente)
-- ---------------------------------------------------------------------------

-- a. Propriété des objets existants (agents, pipelines, catalogues) : le rôle
--    `admin` devient propriétaire (verrouillage initial propre : les comptes
--    non-admin perdent la propriété historique par compte ; l'admin
--    redistribue ensuite les droits via /admin/roles).
update agents.agents a
   set owner_role_id = r.id
  from iam.roles r
 where r.key = 'admin'
   and a.owner_role_id is null;

update connectors.pipelines p
   set owner_role_id = r.id
  from iam.roles r
 where r.key = 'admin'
   and p.owner_role_id is null;

update lakehouse.catalog_registry cr
   set owner_role_id = r.id
  from iam.roles r
 where r.key = 'admin'
   and cr.owner_role_id is null;

-- b. Rôles technique/metier supprimés : leurs utilisateurs passent au rôle
--    public, le rôle actif des concernés est repositionné, puis suppression.
insert into iam.user_roles (user_id, role_id)
select distinct ur.user_id, pr.id
  from iam.user_roles ur
  join iam.roles r on r.id = ur.role_id
  join iam.roles pr on pr.key = 'public'
 where r.key in ('technique', 'metier')
on conflict (user_id, role_id) do nothing;

update iam.user_active_role uar
   set role_id = pr.id,
       updated_at = now()
  from iam.roles r
  join iam.roles pr on pr.key = 'public'
 where r.id = uar.role_id
   and r.key in ('technique', 'metier');

delete from iam.user_roles ur
  using iam.roles r
 where r.id = ur.role_id
   and r.key in ('technique', 'metier');

delete from iam.roles r
 where r.key in ('technique', 'metier')
   and not exists (select 1 from iam.user_roles ur where ur.role_id = r.id);

-- ---------------------------------------------------------------------------
-- 14. Backfill des utilisateurs existants (premier créé = admin)
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
  on r.key = case when o.rn = 1 then 'admin' else 'public' end
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
-- 15. Nettoyage de l'ancien modèle de permissions (RBAC refonte)
-- ---------------------------------------------------------------------------

-- L'ancienne colonne iam.roles.permissions et la fonction iam.has_permission
-- sont remplacées par iam.grants / iam.has_grant / iam.is_admin. Les
-- politiques ci-dessus ont déjà été recréées sur le nouveau modèle.
drop function if exists iam.has_permission(uuid, text);
alter table iam.roles drop column if exists permissions;

-- L'ancienne permission admin.billing servait la section Facturation retirée.
drop function if exists admin.usage_metrics();

commit;
