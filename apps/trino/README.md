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
| État | sans état ; les requêtes passent par le principal root Polaris à ce stade (le RBAC applicatif — rôle actif, permissions par catalogue — viendra avec l'interface d'administration) |

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
