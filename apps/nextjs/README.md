# ParusDB — Interface (Next.js)

Application web ParusDB : frontend + BFF (Backend-For-Frontend) en Next.js 16
(App Router, React 19, TypeScript strict, Tailwind CSS v4 + shadcn/ui,
`cacheComponents` activé, proxy à la racine pour le refresh de session).

Toute l'interface est en français, la charte appliquée est « Mésange
Charbonnière » (`docs/functional/brand_guidelines.md` — tokens dans
`app/globals.css`, polices Inter / Space Grotesk / JetBrains Mono via
`next/font`).

## Démarrage

```bash
npm install
npm run dev        # http://localhost:3000
```

Prérequis : les stacks `apps/supabase` (overrides `rustfs` + `rustfs-restart`
+ `kong` actifs), `apps/polaris`, `apps/trino`, `apps/mcp-trino` et
`apps/ollama` démarrées, et le schéma applicatif appliqué (voir AGENTS.md §5).
Copier `.env.example` en `.env.local` et renseigner les valeurs locales —
les secrets s'importent depuis les `.env` des stacks **sans jamais les
afficher** (copie par `sed`/`grep`, pas de copier-coller dans un terminal).

## Fonctionnalités

| Section | Route | État |
|---|---|---|
| Connexion / inscription / réinitialisation | `/auth/*` | Fonctionnel (charte : charbon + grille + halo jaune) |
| Chat IA (Ollama + mcp-trino, diffusion Supabase Realtime) | `/chat` | Fonctionnel — question → exploration lakehouse → SQL → réponse |
| Agents IA (CRUD, modèles, sources) | `/agents` | Fonctionnel |
| Data Lakehouse (catalogues Polaris, éditeur SQL Trino) | `/data-lakehouse` | Fonctionnel |
| Connecteurs ELT (dlt) | `/connectors` | Interfaces mockées — exécution simulée, moteur non intégré |
| Administration (utilisateurs, rôles, serveurs, facturation) | `/admin/*` | Fonctionnel |
| Support (documentation, tickets) | `/support` | Fonctionnel |

## Variables d'environnement (`.env.local`)

| Variable | Rôle |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Gateway de la stack (`http://localhost:8000` — Kong sur cette installation) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clé publishable (navigateur) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service_role — **serveur uniquement**, importée de `apps/supabase/.env` (`SERVICE_ROLE_KEY`) |
| `PARUSDB_ENCRYPTION_KEY` | Clé AES-256-GCM des credentials (`openssl rand -hex 32`) |
| `OLLAMA_URL` / `OLLAMA_DEFAULT_MODEL` / `PARUSDB_AGENT_MAX_STEPS` | Serveur d'inférence, modèle par défaut, plafond d'allers-retours outils |
| `MCP_TRINO_URL` | Endpoint MCP Streamable HTTP (`http://localhost:8185/mcp`) |
| `TRINO_URL` / `TRINO_USER` | Moteur SQL + utilisateur applicatif tracé dans les logs Trino |
| `TRINO_DEFAULT_CATALOG_BINDING` | Catalogue Trino lié au catalogue Polaris par défaut (`polaris`) |
| `TRINO_CATALOG_DIR` | Dossier des `.properties` Trino (`../trino/catalog`) : l'app y écrit les bindings des nouveaux catalogues |
| `POLARIS_API_URL` / `POLARIS_REALM` / `POLARIS_ROOT_CLIENT_ID` / `POLARIS_ROOT_CLIENT_SECRET` | API Management Polaris (secret importé de `apps/polaris/.env`) |
| `POLARIS_DEFAULT_CATALOG` / `POLARIS_S3_BUCKET` / `POLARIS_S3_ENDPOINT` / `POLARIS_S3_REGION` | Catalogue par défaut et stockage (RustFS) |
| `PARUSDB_DOC_URL` | Lien documentation du menu Support |

## Architecture applicative

- **Auth** : Supabase self-hosted via la gateway (`http://localhost:8000` —
  override **Kong actif** sur cette installation). Les clients vivent dans
  `lib/supabase/` (`client.ts` navigateur, `server.ts` RSC/actions,
  `admin.ts` clé service_role — serveur uniquement). Le refresh de session est
  assuré par `proxy.ts` → `lib/supabase/proxy.ts`.
- **RBAC** : rôles applicatifs et permissions dans PostgreSQL (schéma `iam`,
  tables `roles`, `user_roles`, `user_active_role`, fonction
  `iam.has_permission`). Le rôle actif se change en bas de sidebar sans se
  déconnecter. Les permissions filtrent la navigation ET l'accès serveur
  (`lib/session.ts` : `requirePermission`).
- **Schémas métier PostgreSQL** : `iam`, `agents`, `chat`, `lakehouse`,
  `connectors`, `admin`, `support` — DDL versionné et idempotent dans
  `apps/supabase/sql/01-parusdb-app.sql` (RLS partout, TO authenticated +
  prédicat d'appartenance). PostgREST les expose via `PGRST_DB_SCHEMAS` ;
  côté client, `supabase.schema('<schéma>')` envoie `Accept-Profile`.
- **Chat IA** : route `app/(app)/chat/[id]/stream/route.ts` — boucle
  Ollama (function calling) ↔ mcp-trino (lecture seule), messages persistés
  dans `chat.messages`, titre généré par l'IA, requêtes SQL journalisées dans
  `lakehouse.query_history`. Le modèle ne reçoit aucune chaîne de connexion.
  La diffusion temps réel passe par **Supabase Realtime** : le BFF insère
  les évènements dans `chat.stream_events` (publication `supabase_realtime`,
  RLS par propriétaire), le navigateur s'abonne via `postgres_changes`.
- **Lakehouse** : CRUD des catalogues via l'API Management Polaris
  (`lib/polaris.ts`, spec 1.8.0), requêtage via le client officiel
  **trino-js-client** (`lib/trino.ts`, npm `trino-client` — renommer vers
  `@trinodb/trino-js-client` lors d'une montée à Node 24), exploration des
  schémas/tables/colonnes via `information_schema`, métriques disque via les
  tables metadata `$files`. La suppression purge le contenu par DROP Trino
  (`polaris.config.drop-with-purge.enabled`) puis supprime le catalogue.
  La création d'un catalogue génère le binding Trino (`TRINO_CATALOG_DIR`) —
  redémarrage Trino requis pour l'activer.
- **Secrets** : credentials des connecteurs et clés API LLM chiffrés
  AES-256-GCM (`lib/crypto.ts`, clé `PARUSDB_ENCRYPTION_KEY`), jamais
  renvoyés au client.

## Conventions de code (acquises lors de la mise en place)

- **Pages à session** : `export const instant = false` sur le layout `(app)`
  **et** chaque page du groupe — sinon `cacheComponents` refuse le
  prérendu (« uncached or runtime data during prerendering »).
- **Server Actions** colocalisées par feature (`actions.ts`), entrées
  validées, `revalidatePath`/`redirect` explicites. Les actions retournent
  des `{ ok, error }` français et actionnables, jamais d'exception brute.
- **Components clients** : hydratation sans effet via `useSyncExternalStore`
  (`useIsHydrated`), restauration `sessionStorage` via `requestAnimationFrame`
  dans l'effet (eslint react-hooks v6 interdit `setState` synchrone en
  effet), remontée des dialogues par `key` pour réinitialiser les états.
- **shadcn** : composants uniquement via `npx shadcn@latest add` ; ils
  importent `cn` via l'alias tsconfig (`"cn": ["./lib/utils.ts"]`).
- **SQL embarqué côté serveur** : identifiants quotés (`quoteIdent`),
  agrégats par page de résultats Trino, erreurs remontées en français.
- **Aucune mention d'outil IA** dans les commits (AGENTS.md §14) : jamais de
  trailer « Generated by … » ni de `Co-Authored-By:` d'agent IA.

## Vérifications et dépannage

Livraison : `npm run lint`, `npx tsc --noEmit`, `npm run build` — puis
vérification RLS par requêtes de test et, pour le chat, un test e2e rejoué
(le LLM est non déterministe : ne jamais conclure sur une seule exécution).

| Symptôme | Cause probable | Correction |
|---|---|---|
| `PGRST205 Could not find the table` alors qu'elle existe | Schéma absent de `PGRST_DB_SCHEMAS` | L'ajouter dans `apps/supabase/.env` puis `docker compose up -d rest` (recréation, pas restart) |
| Réponse de chat partielle ou figée | Abonnement Realtime établi après l'envoi | Le composant attend `SUBSCRIBED` avant de poster ; vérifier que `chat.stream_events` est dans la publication `supabase_realtime` |
| Nouveau catalogue invisible dans l'éditeur SQL | Trino ne charge les catalogues qu'au démarrage | `cd apps/trino && sh run.sh restart` |
| `Could not find the table 'public.<x>'` | Requête sans `Accept-Profile` | Passer par `supabase.schema('<schéma>')` |
| `node` échoue avec `GLIBCXX_3.4.x not found` | `LD_LIBRARY_PATH` d'une extension VS Code qui masque le libstdc++ système | `unset LD_LIBRARY_PATH` avant toute commande node/npm |
| Chat en erreur « modèle propriétaire non pris en charge » | L'agent pointe un fournisseur non-Ollama | Configurer un modèle Ollama pour cet agent (l'exécution propriétaire n'est pas encore implémentée) |
| La gateway ne répond plus après un reset du stack | `COMPOSE_FILE` régénéré sans l'override | `sh run.sh config add kong` puis `sh run.sh start` (idem `rustfs`, `rustfs-restart`) |

## Limites assumées

- L'exécution des modèles propriétaires (OpenAI, Anthropic…) n'est pas encore
  active : les clés se configurent en administration, mais les conversations
  exigent un modèle Ollama local pour l'instant.
- L'éditeur SQL s'exécute sous l'utilisateur Trino unique : le RBAC porte sur
  la visibilité des catalogues par rôle, pas sur des rôles Trino distincts.
- Les connecteurs ELT sont des interfaces mockées (test de connexion et
  exécutions simulés) — dlt n'est pas encore intégré.
