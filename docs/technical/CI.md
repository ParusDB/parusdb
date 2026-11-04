# CI ParusDB - tests automatiques et e2e manuel

> Ce document décrit ce que la CI exécute à chaque push/PR, les tests
> unitaires du dépôt et le test e2e manuel du moteur ELT.
> Complément de `AGENTS.md` §13 (definition of done).

## Vue d'ensemble

| Workflow | Déclenchement | Contenu |
|---|---|---|
| `ci.yml` | push (`main`, `v1.0.0`) + toute PR | 5 jobs en parallèle (voir ci-dessous) |
| `gitleaks.yml` | push + PR | scan de secrets sur tout l'historique |
| `e2e-elt.yml` | **manuel uniquement** (`workflow_dispatch`) | installation éphémère complète + chargement ELT + assertions Trino |

## Jobs de la CI (`ci.yml`)

1. **Frontend** - `lint` + `typecheck` + `npm test` (Vitest) + `build`
   dans `apps/nextjs` (Node 22, `npm ci`).
2. **SQL** - PostgreSQL 17 éphémère (service container). Enchaîne :
   shim Supabase minimal (`apps/supabase/sql/tests/ci-shim-supabase.sql` :
   rôles, `auth.users`, `auth.uid()`, publication realtime), le schéma
   applicatif **deux fois** (preuve d'idempotence), le rôle `parus_dlt`
   puis les tests RLS (`rls-rbac-test.sql`) **rejoués deux fois** - un
   compte administrateur de test est créé au préalable pour activer les
   sections T7/T8. La sortie machine est vérifiée ligne à ligne par
   `scripts/ci/ci-parse-rls.py` (chaque « (attendu X) » doit correspondre).
   Les refus RLS attendus apparaissent en `ERROR` dans le journal : c'est
   le comportement voulu, l'échec du job vient du parseur (18 assertions).
3. **Shellcheck** - tous les scripts `*.sh` (racine + apps), seuil
   `--severity=warning`.
4. **Compose** - `docker compose config -q` sur chaque app avec
   `.env.example` + `scripts/ci/compose-dummy.env` (placeholders pour les
   secrets générés par les `setup.sh`). Aucun vrai secret ne quitte les
   machines.
5. **Runner dlt** - `pytest` sur `apps/dlt/tests` (Python 3.12,
   `dlt[sql-database,sqlalchemy]==1.31.0` - version épinglée du Dockerfile).

Règle : les échecs de ces jobs sont bloquants pour une PR (AGENTS.md §13).

## Tests unitaires du dépôt

### `apps/nextjs` (Vitest, `npm test`)

- `tests/crypto.test.ts` - chiffrement AES-256-GCM des credentials
  (aller-retour, IV aléatoire, opacité, refus sur mauvaise clé, masque) ;
- `tests/rbac.test.ts` - capacité `can()` : hiérarchie
  read < write < manage, propriété par rôle, admin qui hérite de tout ;
- `tests/llm.test.ts` - normalisation des backends LLM : arguments
  d'outils Ollama/OpenAI, blocs texte des modèles de raisonnement, ids
  d'appels conservés, validation des noms de modèles ;
- `tests/sources.test.ts` - cohérence du registre `SOURCES` face au
  runner dlt (unicité des clés, kinds connus, credentials PostgreSQL et
  Kafka).

### `apps/dlt` (pytest, `pytest -q tests`)

- `tests/test_runner.py` - construction des URL SQL (échappement des
  caractères spéciaux, ports par défaut), registre `kind_of` aligné sur
  le wizard frontend, format du blob chiffré compatible avec le BFF
  Next.js (`lib/crypto.ts`).

Un test qui reproduit un bug précède sa correction (AGENTS.md §13) :
ajouter le cas de régression dans ces fichiers.

## E2E ELT manuel (`e2e-elt.yml`)

**Pourquoi manuel** : le test construit une plateforme complète
(conteneurs de données, build de l'image runner, durcissement TLS Trino),
20 à 40 minutes - beaucoup trop pour chaque PR. Il valide le parcours
réel de bout en bout là où la CI teste les briques isolément.

**Lancement** : onglet Actions du dépôt GitHub → « E2E ELT (manuel) » →
bouton *Run workflow*. Alternative en local :
`sh scripts/ci/e2e-elt.sh` (attention : conflits de ports si la stack
tourne déjà sur la machine).

**Étapes du test** (`scripts/ci/e2e-elt.sh`) :

1. stack Supabase (`db`, RustFS, Kong) + secrets générés + schéma
   applicatif ;
2. Polaris : catalogues système (`parusdb`) + environnement (`dev`) ;
3. Trino durci (HTTPS, comptes par rôle, access control) ;
4. moteur dlt : rôle `parus_dlt`, image runner, ordonnanceur ;
5. sources de démo : PostgreSQL (`apps/dlt/demo/docker-compose.yml`) et
   Kafka Redpanda (`docker-compose.kafka.yml`) + 12 messages produits ;
6. deux pipelines créés **en SQL avec credentials chiffrés** (comme le
   fait l'interface) : `demo-pg-sales` → `dev.ventes_demo`,
   `demo-kafka-events` → `dev.evenements_kafka` ;
7. attente des runs puis **assertions Trino** : les comptes de lignes du
   lakehouse doivent égaler les comptes des sources.

**Hors périmètre** : Ollama et le Chat IA (GPU absent sur les runners -
`sh run.sh test` dans `apps/ollama` reste le test e2e du Chat IA sur une
machine en disposant), mcp-trino, frontend (Playwright à venir).

**En cas d'échec** : le job imprime l'état des conteneurs, les journaux
de l'ordonnanceur dlt et la fin des logs des setups ; le nettoyage
(conteneurs, volumes, `.env` de test) se fait dans tous les cas.
