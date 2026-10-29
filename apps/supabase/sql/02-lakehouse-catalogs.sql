-- ---------------------------------------------------------------------------
-- ParusDB — seed applicatif des catalogues créés au setup.
--
-- Enregistre dans le registre applicatif (descriptions, propriété par rôle)
-- les catalogues Polaris créés par apps/polaris/setup.sh :
--   - le catalogue système de la plateforme (POLARIS_SYSTEM_CATALOG, ex.
--     `parusdb` — catalogue par défaut de la plateforme, premier créé, non
--     supprimable : usage libre, administration de ParusDB, données
--     internes, l'équivalent de la base « snowflake » de Snowflake) ;
--   - le catalogue d'environnement initial (POLARIS_DEFAULT_CATALOG, ex.
--     `dev` — premier catalogue de données ; les pipelines ELT visent
--     librement n'importe quel catalogue du lakehouse).
--
-- Polaris reste la source de vérité des catalogues : ce seed ne crée rien côté
-- Iceberg, il ne fait que décrire et attribuer la propriété.
--
-- RBAC refonte (docs/functional/rbac_refonte.md) : l'accès par rôle vit dans
-- iam.grants (distribué par l'admin via /admin/roles) et la propriété dans
-- catalog_registry.owner_role_id — les catalogues d'installation appartiennent
-- au rôle système `admin`, qui hérite de tout : aucun grant à seed-er.
--
-- Idempotent : relançable sans risque (les descriptions sont resynchronisées,
-- la propriété conservée si déjà posée).
--
-- Exécution (à appliquer après 01-parusdb-app.sql, avec les noms réels) :
--   docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v system_catalog=parusdb -v default_catalog=dev \
--     < apps/supabase/sql/02-lakehouse-catalogs.sql
-- ---------------------------------------------------------------------------

-- Description applicative et propriété des deux catalogues d'installation
-- (rôle système `admin`, hérite de tout — backfill pour les installations
-- existantes dont owner_role_id serait vide).
insert into lakehouse.catalog_registry (catalog_name, description)
values
  (:'system_catalog',
   'Catalogue système de la plateforme : usage libre (administration de ParusDB, données internes).'),
  (:'default_catalog',
   'Catalogue d''environnement par défaut. Créez vos propres catalogues selon vos besoins (prod, stg…).')
on conflict (catalog_name) do update
  set description = excluded.description,
      updated_at = now();

update lakehouse.catalog_registry cr
   set owner_role_id = r.id
  from iam.roles r
 where r.key = 'admin'
   and cr.catalog_name in (:'system_catalog', :'default_catalog')
   and cr.owner_role_id is null;
