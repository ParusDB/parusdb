-- ---------------------------------------------------------------------------
-- ParusDB — seed applicatif des catalogues créés au setup.
--
-- Enregistre dans le registre applicatif (descriptions, RBAC) les catalogues
-- Polaris créés par apps/polaris/setup.sh :
--   - le catalogue système de la plateforme (POLARIS_SYSTEM_CATALOG, ex.
--     `parusdb` — catalogue par défaut de la plateforme, premier créé, non
--     supprimable : usage libre, administration de ParusDB, données
--     internes, l'équivalent de la base « snowflake » de Snowflake) ;
--   - le catalogue d'environnement initial (POLARIS_DEFAULT_CATALOG, ex.
--     `dev` — premier catalogue de données ; les pipelines ELT visent
--     librement n'importe quel catalogue du lakehouse).
--
-- Polaris reste la source de vérité des catalogues : ce seed ne crée rien côté
-- Iceberg, il ne fait que décrire et ouvrir l'accès.
--
-- Idempotent : relançable sans risque (les descriptions sont resynchronisées,
-- les accès existants ignorés).
--
-- Exécution (à appliquer après 01-parusdb-app.sql, avec les noms réels) :
--   docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v system_catalog=parusdb -v default_catalog=dev \
--     < apps/supabase/sql/02-lakehouse-catalogs.sql
-- ---------------------------------------------------------------------------

-- Description applicative des deux catalogues d'installation.
insert into lakehouse.catalog_registry (catalog_name, description)
values
  (:'system_catalog',
   'Catalogue système de la plateforme : usage libre (administration de ParusDB, données internes).'),
  (:'default_catalog',
   'Catalogue d''environnement par défaut. Créez vos propres catalogues selon vos besoins (prod, stg…).')
on conflict (catalog_name) do update
  set description = excluded.description,
      updated_at = now();

-- Accès aux catalogues d'installation pour tous les rôles disposant de la
-- permission `lakehouse` (même règle que la création d'un catalogue par l'app).
insert into lakehouse.catalog_access (role_id, catalog_name)
select r.id, c.catalog_name
from iam.roles r
cross join (values (:'system_catalog'), (:'default_catalog')) as c(catalog_name)
where 'lakehouse' = any (r.permissions)
on conflict (role_id, catalog_name) do nothing;
