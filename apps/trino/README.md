# Trino — ParusDB

Trino est l'unique moteur SQL du Data Lakehouse ParusDB (AGENTS.md §10) : il
interroge le catalogue Iceberg Apache Polaris (`apps/polaris`) et lit les
fichiers de données dans le RustFS de la stack Supabase via des credentials
vendus par Polaris. Trino ne stocke aucun secret d'infrastructure.

## Architecture

| Brique | Choix |
|---|---|
| Image | `trinodb/trino:484` |
| Catalogues | un fichier `catalog/<catalogue>.properties` par catalogue Polaris (généré par `setup.sh` : `dev` par défaut + `parusdb` système) : connecteur Iceberg REST → `http://polaris:8181/api/catalog`, OAuth2 client credentials, realm `POLARIS`, warehouse = le catalogue du même nom |
| Credentials S3 | vendus par Polaris (`iceberg.rest-catalog.vended-credentials-enabled=true`) — aucun secret statique côté Trino |
| Réseau | externe `supabase_default` (stacks Supabase et Polaris démarrées) |
| État | sans état ; les requêtes passent par le principal root Polaris. Le RBAC applicatif (rôle actif, grants `iam.grants` + propriété `owner_role_id`) est implémenté **côté application** (l'éditeur SQL exige Lecture pour une requête de lecture, Écriture pour toute requête modifiante) — le compte de service BFF n'est pas contraint par les règles Trino |
| Durcissement | HTTPS (certificat autosigné, port public **8453**) + authentification password file bcrypt + access control par règles JSON générés depuis `iam.grants` par le BFF (rbac_refonte.md §9) |

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

- UI web + API HTTPS : `https://localhost:8453` (certificat autosigné,
  authentification obligatoire — `/v1/info` seul répond sans auth)
- CLI SQL : `sh run.sh cli` (compte de service BFF, mot de passe lu dans
  `.env`)
- Catalogues Trino : `dev` (environnement) et `parusdb` (système), au nom de leur catalogue Polaris (ex. `SHOW SCHEMAS FROM dev`)

## Durcissement (rbac_refonte.md §9)

Trino est un **artefact dérivé de `iam.grants`** — l'admin ne change pas
d'UX :

- **HTTPS** : keystore autosigné (`etc/keystore.pem`, régénéré par
  `setup.sh` si absent — le conteneur est alors recréé : un bind-mount de
  fichier unique ne voit pas le nouvel inode). Le certificat public
  (`etc/keystore.crt`) porte les SANs `parus-trino`, `trino`, `localhost`,
  `127.0.0.1` et sert d'autorité de confiance à mcp-trino (`SSL_CERT_FILE`).
- **Authentification** : `http-server.authentication.type=PASSWORD` +
  authenticator `file` (`security/password.db`, rechargé toutes les 5 s).
  Format `user:bcrypt` (`$2y$`, cost 10). Le secret interne
  `internal-communication.shared-secret` est **obligatoire** dès qu'une
  authentification est activée, même en mono-noeud.
- **Comptes** : deux comptes de service gérés par `setup.sh`
  (`TRINO_SERVICE_USER` pour le BFF, `TRINO_MCP_USER` pour mcp-trino —
  mots de passe dans `.env`, hashés via un conteneur éphémère
  `httpd:2-alpine htpasswd -B`) ; les comptes applicatifs sont gérés par le
  BFF (`lib/trino-security.ts`) : mot de passe affiché une seule fois,
  hash fusionné dans `password.db`, ligne retirée à la suppression
  (révocation immédiate).
- **Access control** : `security/rules.json` régénéré en entier par le BFF
  à chaque modification de grants de catalogue / de comptes applicatifs
  (rechargé toutes les 5 s, sans redémarrage). Mapping : Lecture →
  `read-only` ; Écriture → + `SELECT`/`INSERT`/`DELETE`/`UPDATE` ; Gestion →
  + `OWNERSHIP` + schémas `owner`. Première règle qui matche s'applique,
  sans correspondance = refus. **Piège** : une section `schemas`/`tables`
  vide fait échouer `SHOW SCHEMAS` pour tout le monde — elle doit être
  absente du JSON.
- Le port HTTP clair n'est plus publié (l'authentification exige TLS) ;
  tout client direct (dbt, JDBC/ODBC, scripts) passe par
  `/admin/informations` pour les paramètres de connexion.

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
  catalogues (`TRINO_CATALOG_DIR`) puis **redémarre automatiquement le
  conteneur** (`lib/trino-restart.ts`, CLI docker — différé tant qu'une
  requête SQL est en cours) ; l'UI suit l'état du cycle. Seuls les bindings
  d'installation (`parusdb.properties`, `dev.properties`) sont versionnés.
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
