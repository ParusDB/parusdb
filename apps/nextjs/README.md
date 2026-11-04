# ParusDB — Interface (Next.js)

Application web ParusDB : frontend + BFF (Backend-For-Frontend) en Next.js 16
(App Router, React 19, TypeScript strict, Tailwind CSS v4 + shadcn/ui,
`cacheComponents` activé, proxy à la racine pour le refresh de session).

Toute l'interface est en français, la charte appliquée est « Mésange
Charbonnière » (`docs/functional/brand_guidelines.md` — tokens dans
`app/globals.css`, polices Inter / Space Grotesk / JetBrains Mono
**auto-hébergées** via `next/font/local`, fichiers variables woff2 et
licences SIL OFL dans `app/fonts/` — le build n'interroge jamais Google
Fonts, y compris en CI).

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
| Chat IA (LLM au choix — Ollama local ou fournisseur par clé API — + mcp-trino, diffusion Supabase Realtime) | `/chat` | Fonctionnel — question → exploration lakehouse → SQL → réponse |
| Agents IA (CRUD, modèles, sources) | `/agents` | Fonctionnel |
| Data Lakehouse (catalogues Polaris, éditeur SQL Trino) | `/data-lakehouse` | Fonctionnel |
| Connecteurs ELT (dlt) | `/connectors` | Fonctionnel — introspection réelle, exécution dlt (apps/dlt), historique des runs |
| Administration (utilisateurs, rôles, fournisseurs LLM, informations) | `/admin/*` | Fonctionnel |

## Variables d'environnement (`.env.local`)

| Variable | Rôle |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Gateway de la stack (`http://localhost:8000` — Kong sur cette installation) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clé publishable (navigateur) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service_role — **serveur uniquement**, importée de `apps/supabase/.env` (`SERVICE_ROLE_KEY`) |
| `PARUSDB_ENCRYPTION_KEY` | Clé AES-256-GCM des credentials (`openssl rand -hex 32`) |
| `OLLAMA_URL` / `OLLAMA_DEFAULT_MODEL` / `PARUSDB_AGENT_MAX_STEPS` | Serveur d'inférence, modèle par défaut, plafond d'allers-retours outils |
| `MCP_TRINO_URL` | Endpoint MCP Streamable HTTP (`http://localhost:8185/mcp`) |
| `TRINO_URL` / `TRINO_USER` / `TRINO_PASSWORD` / `TRINO_CONTAINER_NAME` | Moteur SQL durci (HTTPS, port public 8453), compte + mot de passe de service BFF (basic auth, importés de `apps/trino/.env` par le setup racine), conteneur redémarré automatiquement après création d'un catalogue |
| `TRINO_CATALOG_DIR` | Dossier des `.properties` Trino (`../trino/catalog`) : l'app y écrit les bindings des nouveaux catalogues (fichier portant le nom du catalogue) |
| `TRINO_SECURITY_DIR` / `TRINO_MCP_USER` | Dossier des fichiers de sécurité Trino (`../trino/security`) : `password.db` (bcrypt des comptes applicatifs, affichés une fois) + `rules.json` (access control) régénérés depuis `iam.grants` par `lib/trino-security.ts` ; nom du compte de service mcp-trino dans les règles |
| `POLARIS_API_URL` / `POLARIS_REALM` / `POLARIS_ROOT_CLIENT_ID` / `POLARIS_ROOT_CLIENT_SECRET` | API Management Polaris (secret importé de `apps/polaris/.env`) |
| `POLARIS_SYSTEM_CATALOG` / `POLARIS_S3_BUCKET` / `POLARIS_S3_ENDPOINT` / `POLARIS_S3_REGION` | Catalogue système (par défaut de la plateforme) et stockage (RustFS) |
| `PARUSDB_DLT_IMAGE` / `PARUSDB_DLT_NETWORK` | Runner dlt pour le « Test connexion » du wizard (introspection en conteneur jetable) — image construite par `apps/dlt` |

## Architecture applicative

- **Auth** : Supabase self-hosted via la gateway (`http://localhost:8000` —
  override **Kong actif** sur cette installation). Les clients vivent dans
  `lib/supabase/` (`client.ts` navigateur, `server.ts` RSC/actions,
  `admin.ts` clé service_role — serveur uniquement). Le refresh de session est
  assuré par `proxy.ts` → `lib/supabase/proxy.ts`.
- **RBAC (modèle à grants, refonte)** : rôles multiples + **rôle actif** dans
  PostgreSQL (schéma `iam` : tables `roles`, `user_roles`, `user_active_role`,
  `grants`, `app_users`, fonctions `iam.has_grant` / `iam.is_admin`). Les
  droits — Lecture ⊂ Écriture ⊂ Gestion — portent sur les **objets**
  (catalogues, agents, pipelines) ; le rôle actif qui crée un objet en
  devient propriétaire. Les menus sont visibles par tous les comptes : le
  contenu est filtré par le rôle actif via la RLS, l'administration exige le
  rôle `admin` (`lib/session.ts` : `requireAdmin`, `requireGrant`). Les
  conversations appartiennent au compte (partage en lecture seule à un rôle) ;
  les comptes applicatifs (outils data, `/admin/users` → Applicatifs)
  répliquent leurs droits de catalogue en grants Polaris réels
  (`lib/polaris.ts`) **et en règles d'access control Trino** (durcissement :
  `lib/trino-security.ts` → `password.db` + `rules.json`, refus réel sur le
  chemin SQL des outils externes).
- **Schémas métier PostgreSQL** : `iam`, `agents`, `chat`, `lakehouse`,
  `connectors`, `admin` — DDL versionné et idempotent dans
  `apps/supabase/sql/01-parusdb-app.sql` (RLS partout, TO authenticated +
  prédicat d'appartenance). PostgREST les expose via `PGRST_DB_SCHEMAS` ;
  côté client, `supabase.schema('<schéma>')` envoie `Accept-Profile`.
- **Chat IA** : route `app/(app)/chat/[id]/stream/route.ts` — boucle
  LLM ↔ mcp-trino (lecture seule), messages persistés
  dans `chat.messages`, titre généré par l'IA, requêtes SQL journalisées dans
  `lakehouse.query_history`. Le modèle ne reçoit aucune chaîne de connexion.
  La source du modèle de l'agent détermine le backend (`lib/llm.ts` :
  Ollama local, compatible OpenAI, Anthropic — la clé d'un fournisseur
  externe est déchiffrée en mémoire serveur, `lib/providers.ts`), les
  modèles sont découverts dynamiquement via l'API du fournisseur
  (`/admin/providers`).
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
- **Connecteurs ELT** : le « Test connexion » du wizard spawn un conteneur
  jetable du runner dlt (`PARUSDB_DLT_IMAGE`, job JSON sur **stdin** — les
  credentials testés ne sont jamais persistés) ; « Enregistrer »/« Lancer »
  insèrent un run `queued` traité par l'ordonnanceur d'apps/dlt (quelques
  secondes) — jamais d'exécution synchrone dans l'action ; `source_config`
  ne porte que les métadonnées (curseurs), les credentials ne vivent que
  chiffrés dans `credentials_encrypted` ; le panneau des runs se rafraîchit
  par `router.refresh()` tant qu'un run est en file ou en cours.
- **Aucune mention d'outil IA** dans les commits (AGENTS.md §14) : jamais de
  trailer « Generated by … » ni de `Co-Authored-By:` d'agent IA.

## Vérifications et dépannage

Livraison : `npm run lint`, `npm run typecheck`, `npm run build` — puis
vérification RLS par requêtes de test et, pour le chat, un test e2e rejoué
(le LLM est non déterministe : ne jamais conclure sur une seule exécution).

| Symptôme | Cause probable | Correction |
|---|---|---|
| `PGRST205 Could not find the table` alors qu'elle existe | Schéma absent de `PGRST_DB_SCHEMAS` | L'ajouter dans `apps/supabase/.env` puis `docker compose up -d rest` (recréation, pas restart) |
| Réponse de chat partielle ou figée | Abonnement Realtime établi après l'envoi | Le composant attend `SUBSCRIBED` avant de poster ; vérifier que `chat.stream_events` est dans la publication `supabase_realtime` |
| Nouveau catalogue invisible dans l'éditeur SQL | Trino ne charge les catalogues qu'au démarrage | Le redémarrage est automatique (différé tant qu'une requête SQL est en cours) : patienter le retour à la normale du bouton « Redémarrage en cours… » ; en cas d'échec, `cd apps/trino && sh run.sh restart` |
| `Could not find the table 'public.<x>'` | Requête sans `Accept-Profile` | Passer par `supabase.schema('<schéma>')` |
| `node` échoue avec `GLIBCXX_3.4.x not found` | `LD_LIBRARY_PATH` d'une extension VS Code qui masque le libstdc++ système | `unset LD_LIBRARY_PATH` avant toute commande node/npm |
| Chat en erreur « <fournisseur> a répondu HTTP … » ou « Invalid model » | Clé révoquée ou identifiant de modèle absent chez le fournisseur | Vérifier la clé (« Modifier » dans `/admin/providers`) et l'id du modèle de l'agent (sans préfixe de fournisseur) |
| « Could not find the function public.list_providers » (PGRST202) | Appel rpc sans schéma `admin` | PostgREST ne résout pas les fonctions hors de `public` : passer par `supabase.schema("admin").rpc(...)` |
| « Test connexion » du wizard échoue (« docker est-il installé… ») | Image du runner dlt absente | `cd apps/dlt && sh run.sh build` puis `sh run.sh verify` |
| Run resté « En file » | Ordonnanceur dlt arrêté | `cd apps/dlt && sh run.sh status` puis `sh run.sh start` (logs : `sh run.sh logs`) |
| Run en erreur « impossible de déchiffrer les credentials » | `PARUSDB_ENCRYPTION_KEY` divergente entre nextjs et apps/dlt | Relancer `cd apps/dlt && sh setup.sh` (réimporte la clé) puis relancer le pipeline |
| La gateway ne répond plus après un reset du stack | `COMPOSE_FILE` régénéré sans l'override | `sh run.sh config add kong` puis `sh run.sh start` (idem `rustfs`, `rustfs-restart`) |

## Limites assumées

- Les conversations sur un fournisseur par clé API sortent vers l'API du
  fournisseur configuré (Internet) : pour les données sensibles, privilégier
  Ollama local (souveraineté, AGENTS.md §11).
- Les modèles de raisonnement renvoient parfois `content` en tableau de
  blocs (`thinking`/`text`) : seul le texte est retenu (`normalizeContent`
  dans `lib/llm.ts`).
- L'éditeur SQL de l'interface s'exécute sous le compte de service BFF,
  **non contraint** par les règles Trino (durcissement) : sa garde RBAC est
  applicative (`iam.has_grant` : lecture/écriture par catalogue). Les
  comptes applicatifs et les outils externes connectés à Trino, eux, sont
  réellement contraints par les règles d'access control générées depuis
  `iam.grants` — voir `apps/trino/README.md`.
- Connecteurs ELT : le CRON est évalué en UTC ; le mode d'insertion
  (incrémental / toutes les données) s'applique aux sources génériques
  (SQL, REST, fichiers) — les sources verified conservent leurs
  write_dispositions natifs (merge/incrémental intégrés). Les dialectes SQL
  exotiques (Oracle, Snowflake, BigQuery…) exigent d'ajouter le pilote au
  Dockerfile du runner ; `scraping` et `unstructured_data` ne sont pas
  exposées (pilotées par du code). Voir `apps/dlt/README.md`.
