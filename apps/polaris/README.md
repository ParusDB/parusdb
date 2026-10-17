# Apache Polaris — ParusDB

Catalogue Iceberg de ParusDB : Apache Polaris stocke les métadonnées des
catalogues (catalogues → schémas → tables Iceberg) et vends les credentials
d'accès au stockage objet. Rôle strict (AGENTS.md §10) : Polaris ne fait que
du catalogue de métadonnées, jamais de données.

## Architecture

| Brique | Choix |
|---|---|
| Image | `apache/polaris:1.8.0` (+ `apache/polaris-admin-tool:1.8.0` pour le bootstrap) |
| Persistance | **Postgres de la stack Supabase** (`apps/supabase`, service `db`) — base dédiée `polaris`, rôle applicatif dédié, backend `relational-jdbc`. Aucun metastore en mémoire. |
| Object storage | **RustFS de la stack Supabase** (service `rustfs`, override `docker-compose.rustfs.yml`) — bucket `parus-lakehouse`, credentials vendus aux clients (Trino, pipelines dlt) |
| Réseau | externe `supabase_default` (la stack Supabase doit être démarrée) |
| Realm | `POLARIS`, principal root `root` (secret dans `.env`, jamais commité) |

Le service `polaris-bootstrap` s'exécute à chaque démarrage : il crée le realm
et le principal root dans Postgres puis se termine (idempotent).

## Cycle de vie

Identique à `apps/supabase` :

```bash
sh setup.sh   # bootstrap : .env + secrets, base Postgres, bucket RustFS, démarrage, catalogue par défaut
sh run.sh start | stop | restart | status | logs | secrets   # cycle de vie
sh update.sh  # pull des images + recréation + clés .env manquantes
sh reset.sh   # tout réinitialiser (conteneurs, base, .env ; bucket en option)
```

Prérequis : stack Supabase démarrée avec l'override RustFS
(`cd apps/supabase && sh run.sh config add rustfs && sh run.sh start`).

## Points d'entrée

- API Iceberg REST : `http://localhost:8181/api/catalog`
- API Management : `http://localhost:8181/api/management/v1`
- Santé / métriques : `http://localhost:8182/q/health`

## Catalogues

`setup.sh` crée le catalogue d'environnement défini par `POLARIS_DEFAULT_CATALOG`
(`dev` par défaut, cf. AGENTS.md §10 : un catalogue par environnement), avec
`default-base-location` sous `s3://parus-lakehouse/<catalogue>`. Les catalogues
supplémentaires seront créés par l'application via l'API Management.

## Notes opérationnelles

- Versions épinglées dans `docker-compose.yml` : mettre à jour = changer le tag,
  puis `sh update.sh`. Pas de vendor upstream : ces fichiers appartiennent au
  dépôt ParusDB.
- Les clés RSA du token broker OAuth2 vivent dans `volumes/token-keys`
  (gitignorées, générées par `setup.sh`). Sans elles, chaque redémarrage de
  Polaris invaliderait les jetons en cache des clients (Trino).
- Les catalogues sont créés avec `polaris.config.drop-with-purge.enabled=true` :
  les DROP émis par les moteurs (Trino envoie `purgeRequested=true`) suppriment
  physiquement les fichiers Iceberg de RustFS. Un catalogue créé sans cette
  propriété refuse les DROP avec purge (HTTP 403) et laisse des orphelins.
- La suppression d'un catalogue est irréversible (pattern de confirmation +
  ressaisie du nom côté application, spec §Data Lakehouse) ; `reset.sh` supprime
  quant à lui toutes les métadonnées du catalogue.
- `sh run.sh secrets` affiche les secrets du `.env` local : ne jamais les copier
  dans une PR, un log ou une conversation.
