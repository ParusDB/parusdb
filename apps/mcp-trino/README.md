# mcp-trino — ParusDB

mcp-trino (https://github.com/tuannvm/mcp-trino) est le serveur MCP
(Model Context Protocol) qui expose Trino aux LLM : c'est l'unique chemin
LLM ↔ données de ParusDB (AGENTS.md §11). Le modèle ne reçoit jamais de
chaîne de connexion ni de secret : il appelle les outils MCP et le serveur
exécute les requêtes sur Trino. Lecture seule par défaut — le chat ne peut
jamais écrire dans le lakehouse.

## Architecture

| Brique | Choix |
|---|---|
| Image | `ghcr.io/tuannvm/mcp-trino:4.3.1` |
| Transport | MCP Streamable HTTP, endpoint `/mcp` (legacy `/sse` conservé) |
| Outils | `list_catalogs`, `list_schemas`, `list_tables`, `get_table_schema`, `execute_query`, `explain_query` |
| Cible | Trino durci (`apps/trino`) sur le réseau externe `supabase_default`, `https://trino:8443`, compte de service `parus-mcp` (AGENTS.md §10) |
| Politique | lecture seule (`TRINO_ALLOW_WRITE_QUERIES=false`) + règle Trino `read-only` globale ; le périmètre par utilisateur (catalogues du rôle actif) est appliqué par le BFF (apps/nextjs) - ce service est volontairement global, sans allowlist de schémas |
| TLS | certificat autosigné de Trino monté dans le conteneur + `SSL_CERT_FILE` (le transport custom Go ignore `TRINO_SSL_INSECURE` : validation complète) |
| État | sans état ; aucune donnée stockée |

## Cycle de vie

Identique à `apps/supabase` :

```bash
sh setup.sh   # .env, démarrage, test MCP (initialize + tools/list + SELECT 1)
sh run.sh start | stop | restart | status | logs   # cycle de vie
sh run.sh test   # rejouer le test MCP sans réinstaller
sh update.sh  # pull de l'image + recréation + clés .env manquantes
sh reset.sh   # tout réinitialiser (conteneurs + .env ; aucune donnée)
```

Prérequis : stack Supabase puis Trino démarrées (`cd apps/supabase && sh
run.sh start` ; `cd apps/trino && sh run.sh start`).

## Points d'entrée

- Endpoint MCP (BFF Next.js / runner d'agents) : `http://localhost:8185/mcp`
- Statut : `http://localhost:8185/status`
- Test complet Chat IA (Ollama ↔ mcp-trino ↔ Trino) :
  `cd ../ollama && sh run.sh test`

## Notes opérationnelles

- Version épinglée dans `docker-compose.yml` : mettre à jour = changer le
  tag puis `sh update.sh`. Les variables d'environnement peuvent évoluer
  entre versions majeures (relire les release notes amont).
- **Connexion Trino durcie** : `setup.sh` importe le compte de service et
  son mot de passe depuis `apps/trino/.env` (`TRINO_MCP_USER` /
  `TRINO_MCP_PASSWORD`) et resynchronise les clés structurelles
  (`TRINO_SCHEME=https`, `TRINO_PORT=8443`, `TRINO_SSL`, `TRINO_SSL_INSECURE`).
  Piège : le transport Go custom de mcp-trino ignore les DSN `SSL` /
  `SSLInsecure` de trino-go-client — la confiance TLS passe par le certificat
  public de Trino (`../trino/etc/keystore.crt`, SANs `DNS:trino` requis)
  monté en lecture seule et désigné par `SSL_CERT_FILE`.
- **Plus d'allowlist de schémas** (l'ancienne variable `TRINO_ALLOWED_SCHEMAS`
  est retirée) : schémas et catalogues évoluent dans les données (pipelines
  dlt, éditeur SQL, UI lakehouse), pas dans la configuration - une fois
  ParusDB lancé, l'utilisateur n'a pas vocation à toucher les fichiers du
  dépôt. Le périmètre par utilisateur est appliqué par le BFF
  (`apps/nextjs/lib/agent-runner.ts` : catalogues autorisés par le rôle
  actif, garde sur chaque appel d'outil et sur le SQL) ; ce service reste
  le garde-fou serveur lecture seule (règle Trino `read-only` globale +
  catalogue `system` fermé dans rules.json).
- Sans Trino démarré, le serveur s'arrête immédiatement (connexion testée au
  démarrage) : `sh run.sh start` le vérifie avant de lancer le conteneur.
- **L'application (apps/nextjs) est un consommateur de cet endpoint** via
  `lib/mcp.ts` : client Streamable HTTP porté du script e2e — handshake
  `initialize` → `notifications/initialized` → `tools/list` → `tools/call`,
  `Mcp-Session-Id` par message (une session MCP par message utilisateur),
  réponses `text/event-stream` à parser ligne à ligne (`data:`). La boucle
  Ollama ↔ outils vit dans `lib/agent-runner.ts`.
