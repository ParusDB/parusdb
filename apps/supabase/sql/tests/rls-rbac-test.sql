-- Test RLS du modèle RBAC refondu (docs/functional/rbac_refonte.md)
-- Usage : docker exec -i supabase-db psql -U supabase_admin -d postgres < rls-test.sql
-- Crée des fixtures jetables (2 users de test, 1 rôle custom), exécute les
-- scénarios puis nettoie tout. Sans ON_ERROR_STOP : les échecs attendus
-- s'observent dans la sortie (ERROR attendus → marqués ci-dessous).

-- ---------------------------------------------------------------------------
-- 0. Nettoyage préalable (idempotent) + fixtures
-- ---------------------------------------------------------------------------
delete from chat.conversations where owner_id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
delete from agents.agents where owner_id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
delete from connectors.pipelines where owner_id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
delete from auth.users where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
delete from iam.app_users where name = 'app-user-test';
delete from iam.roles where key = 'sales_test';
delete from lakehouse.catalog_registry where catalog_name = 'test_catalog_rls';

insert into iam.roles (key, name, description) values ('sales_test', 'Sales (test)', 'rôle de test RLS');

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000001','authenticated','authenticated','rls-owner@test.local',now(),'{}','{}'),
       ('00000000-0000-4000-8000-000000000002','authenticated','authenticated','rls-member@test.local',now(),'{}','{}');

-- Le trigger on_auth_user_created attribue `admin` au PREMIER compte d'une
-- base fraîche : sur un reset + setup, u1 l'absorberait et fausserait les
-- assertions (is_admin = capacité du compte, quelle que soit le rôle actif).
-- Normalisation : les users de test ne portent QUE public (+ sales_test).
delete from iam.user_active_role where user_id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
delete from iam.user_roles where user_id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');

-- Le trigger on_auth_user_created crée le profil, attribue le rôle public
-- (non-premier compte) et le pose en rôle actif : pas de fixture manuelle ici.
-- Les deux users de test portent en plus le rôle sales_test.
insert into iam.user_roles (user_id, role_id)
select u.id, r.id from auth.users u join iam.roles r on r.key = 'public'
where u.id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
insert into iam.user_roles (user_id, role_id)
select u.id, r.id from auth.users u join iam.roles r on r.key = 'sales_test'
where u.id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
insert into iam.user_active_role (user_id, role_id)
select u.id, r.id from auth.users u join iam.roles r on r.key = 'public'
where u.id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');

-- catalogue de test, possédé par le rôle admin
insert into lakehouse.catalog_registry (catalog_name, description, owner_role_id, created_by)
select 'test_catalog_rls', 'test', r.id, null from iam.roles r where r.key = 'admin'
on conflict (catalog_name) do update set owner_role_id = excluded.owner_role_id;

-- Compte admin pour T7/T8b : sur une base fraîche (onboarding non fait),
-- aucun compte ne porte le rôle admin — la section est SAUTÉE, sinon \gset
-- ne définit rien et :'admin_uid' plante en syntax error.
select exists (
  select 1
    from iam.user_roles ur
    join iam.roles r on r.id = ur.role_id
   where r.key = 'admin'
) as has_admin \gset

-- ---------------------------------------------------------------------------
-- 1. Rôle public : aucun accès (le user ne voit ni catalogue ni agent)
-- ---------------------------------------------------------------------------
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', false);
select 'T1a catalogues visibles (attendu 0)' as test, count(*) as n from lakehouse.catalog_registry;
select 'T1b agents visibles (attendu 0)' as test, count(*) as n from agents.agents;
select 'T1c has_grant read catalogue' as test,
       iam.has_grant(auth.uid(), 'catalog', 'test_catalog_rls', 'read') as ok;
reset role;
commit;

-- grant read sur le catalogue pour sales_test
insert into iam.grants (role_id, resource_type, resource_id, privileges)
select r.id, 'catalog', 'test_catalog_rls', array['read'] from iam.roles r where r.key = 'sales_test'
on conflict (role_id, resource_type, resource_id) do update set privileges = excluded.privileges;

-- ---------------------------------------------------------------------------
-- 2. Rôle actif sales_test : lecture du catalogue accordé, rien de plus
-- ---------------------------------------------------------------------------
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', false);
-- bascule du rôle actif vers sales_test (policy active_role_write_own)
update iam.user_active_role set role_id = (select id from iam.roles where key = 'sales_test')
 where user_id = '00000000-0000-4000-8000-000000000001';
select 'T2a catalogues visibles (attendu 1)' as test, count(*) as n from lakehouse.catalog_registry;
select 'T2b read/write/manage (attendu t/f/f)' as test,
       iam.has_grant(auth.uid(), 'catalog', 'test_catalog_rls', 'read') as r,
       iam.has_grant(auth.uid(), 'catalog', 'test_catalog_rls', 'write') as w,
       iam.has_grant(auth.uid(), 'catalog', 'test_catalog_rls', 'manage') as m;
-- insertion d'un pipeline vers un catalogue en lecture seule : REFUS ATTENDU
savepoint refusal;
insert into connectors.pipelines (owner_id, name, source_type, destination_catalog, owner_role_id)
values ('00000000-0000-4000-8000-000000000001', 'pipeline-refuse', 'sql_database', 'test_catalog_rls',
        (select id from iam.roles where key = 'sales_test'));
rollback to savepoint refusal;
reset role;
commit;

-- grant write sur le catalogue pour sales_test
insert into iam.grants (role_id, resource_type, resource_id, privileges)
select r.id, 'catalog', 'test_catalog_rls', array['read','write'] from iam.roles r where r.key = 'sales_test'
on conflict (role_id, resource_type, resource_id) do update set privileges = excluded.privileges;

-- ---------------------------------------------------------------------------
-- 3. Catalogue en write : création de pipeline autorisée, suppression refusée
-- ---------------------------------------------------------------------------
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', false);
insert into connectors.pipelines (owner_id, name, source_type, destination_catalog, owner_role_id)
values ('00000000-0000-4000-8000-000000000001', 'pipeline-test', 'sql_database', 'test_catalog_rls',
        (select id from iam.roles where key = 'sales_test'));
select 'T3a pipeline créé (attendu 1)' as test, count(*) as n from connectors.pipelines where name = 'pipeline-test';
select 'T3b runs visibles' as test, count(*) as n from connectors.pipeline_runs pr
  join connectors.pipelines p on p.id = pr.pipeline_id where p.name = 'pipeline-test';
-- suppression du pipeline : privilège manage requis -> REFUS ATTENDU
savepoint refusal;
delete from connectors.pipelines where name = 'pipeline-test';
rollback to savepoint refusal;
select 'T3c suppression refusée, pipeline intact (attendu 1)' as test, count(*) as n
  from connectors.pipelines where name = 'pipeline-test';
reset role;
commit;

-- ---------------------------------------------------------------------------
-- 4. Agent possédé par sales_test : le membre du rôle voit et modifie,
--    pas sous le rôle public
-- ---------------------------------------------------------------------------
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', false);
insert into agents.agents (owner_id, name, model_id, owner_role_id)
values ('00000000-0000-4000-8000-000000000001', 'agent-test', 'ministral-3:3b',
        (select id from iam.roles where key = 'sales_test'));
select 'T4a agent créé par le rôle sales_test' as test, count(*) as n from agents.agents where name = 'agent-test';
reset role;
commit;

begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
update iam.user_active_role set role_id = (select id from iam.roles where key = 'sales_test')
 where user_id = '00000000-0000-4000-8000-000000000002';
select 'T4b membre (sales_test) voit l agent (attendu 1)' as test, count(*) as n from agents.agents where name = 'agent-test';
update agents.agents set description = 'modifié par le membre' where name = 'agent-test';
select 'T4c description modifiée' as test, description from agents.agents where name = 'agent-test';
reset role;
commit;

begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
update iam.user_active_role set role_id = (select id from iam.roles where key = 'public')
 where user_id = '00000000-0000-4000-8000-000000000002';
select 'T4d membre (public) voit l agent (attendu 0)' as test, count(*) as n from agents.agents where name = 'agent-test';
select 'T4e membre (public) voit le catalogue (attendu 0)' as test, count(*) as n from lakehouse.catalog_registry;
reset role;
commit;

-- ---------------------------------------------------------------------------
-- 5. Conversation partagée : lecture pour le rôle, écriture refusée
-- ---------------------------------------------------------------------------
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', false);
-- (rôle actif sales_test, propriétaire de l'agent -> read ok)
insert into chat.conversations (owner_id, agent_id, title)
values ('00000000-0000-4000-8000-000000000001',
        (select id from agents.agents where name = 'agent-test'), 'conversation-test');
select 'T5a conversation créée (attendu 1)' as test, count(*) as n from chat.conversations where title = 'conversation-test';
insert into chat.messages (conversation_id, role, content)
select id, 'user', 'message du propriétaire' from chat.conversations where title = 'conversation-test';
-- partage au rôle sales_test
insert into chat.conversation_shares (conversation_id, role_id, granted_by)
select c.id, (select id from iam.roles where key = 'sales_test'), c.owner_id
  from chat.conversations c where c.title = 'conversation-test';
reset role;
commit;

begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
update iam.user_active_role set role_id = (select id from iam.roles where key = 'sales_test')
 where user_id = '00000000-0000-4000-8000-000000000002';
select 'T5b membre voit la conversation partagée (attendu 1)' as test, count(*) as n
  from chat.conversations where title = 'conversation-test';
select 'T5c membre lit les messages (attendu 1)' as test, count(*) as n
  from chat.messages m join chat.conversations c on c.id = m.conversation_id
  where c.title = 'conversation-test';
-- écriture par le membre : REFUS ATTENDU (lecture seule)
savepoint refusal;
insert into chat.messages (conversation_id, role, content)
select id, 'user', 'message du membre' from chat.conversations where title = 'conversation-test';
rollback to savepoint refusal;
-- renommage par le membre : REFUS ATTENDU
savepoint refusal;
update chat.conversations set title = 'vol' where title = 'conversation-test';
rollback to savepoint refusal;
reset role;
commit;

begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', false);
select 'T5d le propriétaire écrit toujours (attendu 1 : le message du membre a été refusé)' as test, count(*) as n
  from chat.messages m join chat.conversations c on c.id = m.conversation_id
  where c.title = 'conversation-test';
reset role;
commit;

-- ---------------------------------------------------------------------------
-- 6. Grants : visibilité limitée au rôle actif, écritures admin only
-- ---------------------------------------------------------------------------
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
select 'T6a grants visibles du rôle actif (attendu 1 : catalog)' as test, count(*) as n from iam.grants;
-- écriture de grant par un non-admin : REFUS ATTENDU
savepoint refusal;
insert into iam.grants (role_id, resource_type, resource_id, privileges)
select id, 'catalog', 'autre', array['read'] from iam.roles where key = 'sales_test';
rollback to savepoint refusal;
reset role;
commit;

-- ---------------------------------------------------------------------------
-- 7. Admin : hérite de tout, indépendamment du rôle actif
-- ---------------------------------------------------------------------------
\if :has_admin
select ur.user_id as admin_uid from iam.user_roles ur join iam.roles r on r.id = ur.role_id where r.key = 'admin' limit 1 \gset
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"' || :'admin_uid' || '","role":"authenticated"}', false);
select 'T7a admin voit tous les catalogues' as test, count(*) as n from lakehouse.catalog_registry;
select 'T7b admin manage sur le catalogue de test (attendu t)' as test,
       iam.has_grant(auth.uid(), 'catalog', 'test_catalog_rls', 'manage') as ok;
select 'T7c admin voit toutes les conversations' as test, count(*) as n from chat.conversations;
select 'T7d admin voit les grants de tous les rôles' as test, count(*) as n from iam.grants;
select 'T7e admin est is_admin (attendu t)' as test, iam.is_admin(auth.uid()) as ok;
reset role;
commit;

-- ---------------------------------------------------------------------------
-- 8. Utilisateurs applicatifs : table réservée à l'admin
-- ---------------------------------------------------------------------------
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', false);
select 'T8a app_users visible par un non-admin (attendu 0)' as test, count(*) as n from iam.app_users;
reset role;
commit;

begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"' || :'admin_uid' || '","role":"authenticated"}', false);
insert into iam.app_users (name, note, role_id, polaris_client_id)
select 'app-user-test', 'test', id, 'client-id-test' from iam.roles where key = 'sales_test';
select 'T8b app_user créé par l admin (attendu 1)' as test, count(*) as n from iam.app_users;
reset role;
commit;
\else
select 'T7/T8b sautés : base fraîche sans compte admin (onboarding non fait) — relancer après création du compte' as test;
\endif

-- ---------------------------------------------------------------------------
-- 9. Nettoyage des fixtures
-- ---------------------------------------------------------------------------
delete from chat.conversation_shares where conversation_id in
  (select id from chat.conversations where title = 'conversation-test');
delete from chat.conversations where title = 'conversation-test';
delete from connectors.pipelines where name in ('pipeline-test', 'pipeline-refuse');
delete from agents.agents where name = 'agent-test';
delete from auth.users where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
delete from iam.app_users where name = 'app-user-test';
delete from iam.roles where key = 'sales_test';
delete from lakehouse.catalog_registry where catalog_name = 'test_catalog_rls';
select 'nettoyage' as test,
  (select count(*) from iam.grants) as grants_restants,
  (select count(*) from agents.agents) as agents_restants,
  (select count(*) from lakehouse.catalog_registry) as catalogues_restants;
