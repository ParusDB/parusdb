# dlt — ParusDB

Moteur ELT de ParusDB : exécution des pipelines définis dans l'interface
(menu Connecteurs, schéma `connectors`) vers le Data Lakehouse — et nulle
part ailleurs (spec §Connecteurs, AGENTS.md §12).

## Architecture

| Brique | Choix |
|---|---|
| Bibliothèque | **dlt** 1.31 épinglé (licence open source dltHub, `dlt[pyiceberg,…]`) + pilotes SQL (psycopg2, pymysql, pymssql) |
| Destination | **Iceberg** via pyiceberg : catalogue REST **Polaris**, données dans **RustFS S3** avec credentials vendus (`vended-credentials`) |
| Sources verified | Dépôt officiel `dlt-hub/verified-sources` **vendé à un commit épinglé** (aucun package PyPI ne les publie — Dockerfile, `VERIFIED_SOURCES_SHA`) ; 26 sources factory + 3 sources ressource |
| Sources core | `sql_database` (14 dialectes SQLAlchemy), `rest_api` (endpoints), `filesystem`/readers (CSV/Parquet/JSONL sur S3, GCS, Azure, SFTP, local, CDN) |
| Exécution | **Un conteneur jetable par run** (`parus-dlt-run-*`, `--rm`) démarré par l'ordonnanceur ; état dlt persisté dans le volume `parus-dlt-state` |
| Ordonnancement | Service long-lived `parus-dlt-scheduler` : réclame les runs `queued`, évalue les CRON (croniter, **UTC**), surveille les conteneurs (crash, délai max) |
| Postgres applicatif | Rôle dédié `parus_dlt` (moindre privilège, RLS `TO parus_dlt` — jamais service_role ni bypassrls) |
| Credentials sources | Chiffrés AES-256-GCM par le BFF (apps/nextjs, `lib/crypto.ts`), déchiffrés en mémoire par le runner (même clé `PARUSDB_ENCRYPTION_KEY`), jamais loggés |

```
interface (Next.js)                ordonnanceur (compose)         conteneur jetable par run
┌──────────────────┐    insert     ┌──────────────────┐  docker-py  ┌─────────────────────┐
│ bouton « Lancer » │──run queued──▶│ parus-dlt-       │────────────▶│ parus-dlt-run-…     │
│ wizard « Test »  │               │ scheduler       │  (socket)   │ runner.main run     │
└──────────────────┘               └──────────────────┘             │  → dlt → pyiceberg  │
        │                                   ▲                       │  → Polaris REST    │
        │ docker run -i (introspect)        └─── statuts écrits ────│  → RustFS (vendu)   │
        ▼                                        dans Postgres      └─────────────────────┘
```

## Cycle de vie

```bash
sh setup.sh    # bootstrap : .env, rôle parus_dlt, image, ordonnanceur, vérifications
sh run.sh start | stop | restart | status | logs | runs | build | verify | catalog
sh update.sh   # rebuild de l'image + recréation de l'ordonnanceur
sh reset.sh    # tout réinitialiser (conteneurs, volume d'état, rôle, .env)
```

Prérequis : stacks Supabase (avec RustFS) et Polaris démarrées, schéma
applicatif appliqué (rappel : `setup.sh` le réapplique — idempotent).

Le `sh run.sh test-run <run_id>` rejoue manuellement un run dans un conteneur
jetable avec l'environnement du `.env` local (debug).

## Sources disponibles

Le registre machine fait foi (`sh run.sh catalog` → JSON consommé par
`apps/nextjs/lib/sources.ts`) :

- **Core — SQL Databases** (14) : PostgreSQL, MySQL, MariaDB, SQL Server,
  SQLite, CockroachDB, Redshift installés (pilotes dans l'image) ; Oracle,
  Snowflake, BigQuery, SAP HANA, Firebird, Teradata, DB2 déclarés — pilote
  requis dans l'image (le runner produit une erreur actionnable sinon).
- **Core — REST APIs / Object Store & Filesystem** : génériques.
- **Verified (29)** : Airtable, Amazon Kinesis, Apache Kafka, Asana, Bing
  Webmaster, Chess, Facebook Ads, Freshdesk, GitHub, Google Ads, Google
  Analytics, Google Sheets, HubSpot, Inbox, Jira, Matomo, MongoDB, Mux,
  Notion, Personio, Pipedrive, PostgreSQL Replication, Salesforce, Shopify,
  Slack, Strapi, Stripe, Workable, Zendesk.
- **Non exposées** : `scraping` (Scrapy) et `unstructured_data` — pilotées
  par du code (spiders, parsers), elles restent vendées dans l'image pour un
  usage en étendant le runner.

## Modèle d'exécution (leçons de la mise en place)

- **Un conteneur par run** : le runner marque `queued → running →
  success/error` dans `connectors.pipeline_runs` et écrit `last_run_at`,
  `status` sur le pipeline. L'ordonnanceur ne fait que démarrer, réconcilier
  (conteneur mort → run en erreur + queue du journal) et arrêter au-delà du
  délai (`PARUSDB_DLT_RUN_TIMEOUT_SECONDS`).
- **L'état dlt persiste** dans le volume `parus-dlt-state` (`HOME=/var/lib/dlt`
  dans l'image) : les cursors incrémentaux survivent aux conteneurs jetables.
  dlt synchronise aussi son état avec la destination (`_dlt_pipeline_state`,
  restauration au démarrage propre) — d'où le modèle « conteneurs jetables,
  environnement propre » préconisé par dltHub pour les orchestrateurs.
- **La config dlt du run vit dans le run** : `<workdir>/.dlt/secrets.toml`
  généré à chaque exécution (clés exactes pyiceberg — `header.Polaris-Realm`
  et `header.X-Iceberg-Access-Delegation` ne sont pas exprimables proprement
  en variables d'environnement dlt). Le fichier disparaît avec le conteneur.
- **`bucket_url` obligatoire** : même en table format Iceberg, la destination
  `filesystem` de dlt exige `bucket_url` (section `destination.filesystem` du
  secrets.toml du run) ; les credentials S3 de cette section ne servent qu'à
  la synchronisation d'état — les données s'écrivent avec les credentials
  vendus par Polaris.
- **Namespace Polaris** : le runner crée le schéma de destination (namespace)
  s'il est absent — Polaris ne crée pas les namespaces implicitement.
- **Incrémental = merge sur clé primaire** : `sql_database` reflète les clés
  primaires ; en mode incrémental le runner utilise `write_disposition=merge`
  (upsert : une ligne modifiée remplace l'ancienne version). Sans clé
  primaire : `append` (une ligne modifiée devient une nouvelle ligne —
  journal). Mode « toutes les données » : `replace`.
- **Verrou par pipeline** : un seul run actif par pipeline (statut `running`
  en base + conteneurs suivis par l'ordonnanceur), sinon les répétitions de
  CRON doubleraient les chargements.
- **Sources à ressource unique** (kafka, kinesis, pg_replication) : le dépôt
  n'y expose pas de factory `@dlt.source` mais une `@dlt.resource(standalone=
  True)` — le runner injecte les credentials via la config dlt
  (`SOURCES__<section>__CREDENTIALS__*`, section = nom du module) et passe le
  paramètre principal (topics, stream) explicitement.
- **Factories multiples** : certains modules (github, zendesk, chess) exposent
  plusieurs factories — la préférence est figée dans `PREFERRED_FACTORIES`
  (github → `github_reactions`, zendesk → `zendesk_support`, chess → `source`).

## Test e2e (validation de référence)

`demo/` fournit une source PostgreSQL bidon (`docker compose -f
demo/docker-compose.yml up -d`, données `seed.sql`) : créer un pipeline de
type PostgreSQL vers le catalogue de destination, l'exécuter, puis
requêter `dev.ventes_demo.orders` côté Trino (ou via le Chat IA — le
chemin question → LLM → mcp-trino → Trino → réponse a été validé avec ces
données). Le mode incrémental se vérifie en insérant un delta dans la source
puis en relançant : le run ne charge que les lignes nouvelles/modifiées.

## Notes opérationnelles

- Le socket Docker de l'hôte est monté dans l'ordonnanceur (nécessaire pour
  démarrer les conteneurs de run) ; l'image du runner n'est jamais publiée
  (build local `parus-dlt-runner:<tag>`).
- Ajouter une source du dépôt verified : ajouter le module dans
  `VERIFIED_MODULES` (`runner/sources.py`), reconstruire (`sh update.sh`),
  régénérer le catalogue (`sh run.sh catalog`) et reporter clés/champs dans
  `apps/nextjs/lib/sources.ts`.
- Les CRON sont évalués en **UTC**.
- `sh run.sh secrets` affiche l'état (jamais la valeur) des secrets du `.env`.
