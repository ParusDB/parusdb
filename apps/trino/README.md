# Trino — ParusDB

Trino est l'unique moteur SQL du Data Lakehouse ParusDB (AGENTS.md §10) : il
interroge le catalogue Iceberg Apache Polaris (`apps/polaris`) et lit les
fichiers de données dans le RustFS de la stack Supabase via des credentials
vendus par Polaris. Trino ne stocke aucun secret d'infrastructure.

## Architecture

| Brique | Choix |
|---|---|
| Image | `trinodb/trino:484` |
| Catalogue | `polaris` (fichier `catalog/polaris.properties`) : connecteur Iceberg REST → `http://polaris:8181/api/catalog`, OAuth2 client credentials, realm `POLARIS`, warehouse = catalogue d'environnement (`dev` par défaut) |
| Credentials S3 | vendus par Polaris (`iceberg.rest-catalog.vended-credentials-enabled=true`) — aucun secret statique côté Trino |
| Réseau | externe `supabase_default` (stacks Supabase et Polaris démarrées) |
| État | sans état ; les requêtes passent par le principal root Polaris. Le RBAC applicatif (rôle actif, permissions par catalogue) est implémenté **côté application** (table `lakehouse.catalog_access`) : il borne la visibilité des catalogues et l'accès aux pages, pas les droits Trino — tout s'exécute sous l'utilisateur Trino unique (limitation assumée) |

## Cycle de vie

Identique à `apps/supabase` :

```bash
sh setup.sh   # .env + import des credentials Polaris, démarrage, test de bout en bout
sh run.sh start | stop | restart | status | logs | cli | secrets   # cycle de vie
sh update.sh  # pull des images + recréation + clés .env manquantes
sh reset.sh   # tout réinitialiser (conteneurs + .env ; aucune donnée lakehouse)
```

Prérequis : stack Supabase (avec RustFS) puis Polaris démarrées
(`cd apps/supabase && sh run.sh start` ; `cd apps/polaris && sh setup.sh`).

## Points d'entrée

- UI web + API HTTP : `http://localhost:8080`
- CLI SQL : `sh run.sh cli`
- Catalogue Trino : `polaris` (ex. `SHOW SCHEMAS FROM polaris`)

## Notes opérationnelles

- Version épinglée dans `docker-compose.yml` : mettre à jour = changer le tag,
  puis `sh update.sh`. Pas de vendor upstream : ces fichiers appartiennent au
  dépôt ParusDB.
- Les projets compose étant distincts (Polaris et Trino), aucun `depends_on`
  inter-projets : `sh run.sh start` vérifie que Polaris répond avant de lancer
  Trino, avec un message d'erreur actionnable sinon.

## Intégration avec l'application (leçons de la mise en place)

- **Un catalogue Polaris = un fichier `catalog/<nom>.properties`** (le nom du
  fichier est le nom du catalogue Trino ; `iceberg.rest-catalog.warehouse`
  désigne le catalogue Polaris). Trino ne charge ses catalogues **qu'au
  démarrage** : l'app (apps/nextjs) génère le `.properties` des nouveaux
  catalogues (`TRINO_CATALOG_DIR`), puis un `sh run.sh restart` est requis —
  l'UI l'indique à l'utilisateur.
- **L'app consomme Trino via le client officiel trino-js-client**
  (`lib/trino.ts`, npm `trino-client`) : itérer toutes les pages du résultat
  (`for await`), remonter `QueryResult.error` en erreur applicative. Le chat,
  lui, passe uniquement par mcp-trino (lecture seule).
- **Métriques disque** : tailles et nombres de fichiers via les tables
  metadata Iceberg `"<catalog>"."<schéma>"."<table>$files"` — les
  identifiants doivent être quottés (`quoteIdent`), y compris le suffixe
  `$files`.
- **Explorateur lakehouse** : schémas via `SHOW SCHEMAS`, tables/colonnes via
  `<catalog>.information_schema.tables` / `.columns` (2 requêtes suffisent).
