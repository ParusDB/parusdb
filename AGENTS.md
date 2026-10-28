# AGENTS.md — ParusDB

> Instructions de développement pour tout agent (IA ou humain) intervenant sur ce dépôt.
> À lire en entier avant la première modification. Les blocs « **Règles** » sont impératifs.
> Conforme à la convention [agents.md](https://agents.md/) : ce fichier est le point d'entrée
> agent ; les fichiers `AGENTS.md` imbriqués (sous-répertoires) priment sur celui-ci pour les
> fichiers qu'ils couvrent ; une instruction explicite de l'utilisateur dans la conversation
> prime sur ce fichier.

---

## 1. Le projet en une minute

**ParusDB** est une plateforme data analytique open source (licence **Apache 2.0**) qui unifie :

- **ELT** : ingestion depuis 40+ sources via **dlt** (data load tool) ;
- **Data Lakehouse** : **Apache Polaris** (catalogue Iceberg) + **Trino** (moteur SQL) +
  **RustFS S3** de Supabase (object storage) ;
- **Chat IA** : agents personnalisables interrogeant le lakehouse en langage naturel via
  **Ollama** (LLM open source en local) ou LLM propriétaires par clé API, connectés à Trino via
  **mcp-trino** (Model Context Protocol).

Produit français, 100 % auto-hébergeable (`docker compose up -d`), souverain (aucune donnée ne
quitte l'infrastructure), sans vendor lock-in. Public mixte : équipes **métiers** (chat, agents)
et **techniques** (RBAC, catalogues, pipelines).

- Site : https://parusdb.com — GitHub : https://github.com/ParusDB/parusdb
- UI en **français** ; code et identifiants techniques en **anglais** (voir §6).

## 2. Sources de vérité et résolution des conflits

| # | Document | Rôle |
|---|---|---|
| 1 | `docs/functional/functional_specifications.md` | Le **QUOI** : menus, fonctionnalités, modèle de données, RBAC, parcours |
| 2 | `docs/functional/brand_guidelines.md` | Le **COMMENT visuellement** : charte « Mésange Charbonnière », tokens, Do/Don't |
| 3 | `docs/functional/product_page.md` | Positionnement, promesses produit, ton |
| 4 | `.agents/skills/supabase/SKILL.md` + `.agents/skills/supabase-postgres-best-practices/SKILL.md` | Règles officielles Supabase/PostgreSQL (sécurité, RLS, perfs) |

**Règles :**

- Lire le document pertinent **avant** de coder une brique (spec fonctionnelle § correspondante,
  charte intégrale avant tout travail UI).
- En cas de contradiction entre docs : la spec fonctionnelle définit le comportement, la charte
  définit l'apparence ; ce fichier tranche sinon. Ne jamais trancher en silence : signaler le
  conflit dans la PR.
- Les skills Supabase sont **obligatoires** pour toute tâche touchant la base, l'auth ou le SQL
  (voir §9). Ils priment sur les souvenirs de l'agent sur Supabase.
- Toute évolution de la charte passe d'abord par la landing, puis est reportée dans
  `brand_guidelines.md` — ne jamais modifier les tokens directement dans l'app sans mise à jour
  du doc.

## 3. État du projet et feuille de route

**Avancement actuel** : le socle technique est en place — template Next.js + Supabase
(authentification complète, clients SSR), stack self-hosted Supabase avec RustFS,
Data Lakehouse (Apache Polaris + Trino) et infrastructure du Chat IA (Ollama GPU +
mcp-trino, test e2e « question → SQL → réponse » validé). **L'interface produit est
implémentée** (charte « Mésange Charbonnière » : Tailwind v4, tokens, polices) : auth,
shell + RBAC (rôles applicatifs, rôle actif), Chat IA fonctionnel (diffusion temps
réel via Supabase Realtime,
Ollama + mcp-trino), Agents IA, Data Lakehouse (catalogues Polaris + éditeur SQL
Trino), Administration (utilisateurs, rôles, fournisseurs LLM). **Les pipelines ELT sont fonctionnels** (apps/dlt : dlt + destination
Iceberg/Polaris + conteneur jetable par run, validation e2e source PostgreSQL →
lakehouse → Trino/LLM, §12). Les tables
applicatives vivent dans les schémas métier PostgreSQL (`iam`, `agents`, `chat`,
`lakehouse`, `connectors`, `admin` — `apps/supabase/sql/01-parusdb-app.sql`,
RLS partout).

**Ordre de construction décidé (feuille de route) :**

1. **Data Lakehouse** (Polaris + Trino + RustFS S3, catalogues, schémas, explorateur, éditeur SQL)
2. **Chat IA** (agents, Ollama, mcp-trino, conversations, streaming)
3. **Interface frontend** (menus, RBAC, administration)
4. **Flux ELT** (dlt, connecteurs, pipelines, CRON)

**Règles :**

- Construire dans cet ordre ; ne pas anticiper une brique non entamée.
- **Prérequis UI** : avant de développer le premier écran de quelque brique que ce soit,
  appliquer le socle design system (§8) : migration Tailwind v4 + tokens de la charte + polices
  + providers. Aucun écran ne sort avec les styles par défaut du template (neutre, police
  Geist).
- Les briques s'appuient sur le modèle de données de la spec (§6 du doc fonctionnel) :
  catalogues lakehouse, agents, chats, rôles applicatifs. PostgreSQL reste la source de
  vérité **transactionnelle** (config, RBAC, métadonnées) ; le lakehouse stocke la donnée
  **analytique**. Ne jamais mélanger.

## 4. Structure du dépôt

```
parusdb/
├── AGENTS.md                     # Ce fichier
├── setup.sh                      # Première installation : orchestre les setup des apps dans l'ordre
│                                 # des dépendances + resynchronise apps/nextjs/.env.local (cf. §5)
├── run.sh                        # Cycle de vie de toute la stack : start/stop/restart/status/logs
│                                 # (délègue aux run.sh des apps, ordre des dépendances)
├── reset.sh                      # Désinstallation complète : reset des apps en ordre inverse
│                                 # (destructif ; option --purge-images pour retirer les images)
├── docs/functional/              # Specs produit : fiche, fonctionnel, charte
├── .agents/skills/               # Skills officiels Supabase (voir §9)
│   ├── supabase/SKILL.md
│   └── supabase-postgres-best-practices/  # SKILL.md + references/*.md (règles par catégorie)
├── apps/mcp-trino/               # mcp-trino — serveur MCP exposant Trino aux LLM
│   ├── docker-compose.yml        # mcp-trino (réseau externe supabase_default, lecture seule)
│   └── run.sh / setup.sh / reset.sh / update.sh  # Cycle de vie (cf. §5)
├── apps/dlt/                    # dlt — moteur ELT (pipelines → lakehouse, cf. §12)
│   ├── Dockerfile               # Image runner : dlt[pyiceberg] + pilotes SQL + sources verified vendées
│   ├── docker-compose.yml       # Ordonnanceur (service long-lived, socket Docker) + volume d'état
│   ├── runner/                  # main.py (run/introspect/catalog) + scheduler.py + sources.py + destination.py
│   ├── sql/01-dlt-role.sql      # Rôle PostgreSQL parus_dlt (moindre privilège)
│   └── demo/                    # Source PostgreSQL bidon + seed (validation e2e)
├── apps/nextjs/                  # Application Next.js 16 (App Router) — frontend + BFF (voir son README.md)
│   ├── app/                      # Routes : auth/ (public) + (app)/ (protégé : chat, agents, data-lakehouse, connectors, admin)
│   ├── components/               # Composants applicatifs (un dossier par feature) + ui/ (shadcn, ne pas éditer à la main)
│   ├── lib/                      # Clients : supabase/ (SSR + admin service_role), session.ts, trino.ts (trino-js-client), polaris.ts, ollama.ts, mcp.ts, agent-runner.ts, crypto.ts, lakehouse.ts, sources.ts
│   ├── types/db.ts               # Types des lignes métier (frontières typées)
│   ├── proxy.ts                  # Proxy Next 16 (ex-middleware) : refresh de session
│   └── app/globals.css           # Tokens de design (charte §3, copiés à l'identique)
├── apps/ollama/                  # Ollama — serveur d'inférence LLM local (GPU NVIDIA)
│   ├── docker-compose.yml        # ollama (runtime nvidia, modèles dans volumes/ollama)
│   ├── scripts/test-mcp-trino.mjs # Test e2e Chat IA : question → LLM → mcp-trino → Trino
│   └── run.sh / setup.sh / reset.sh / update.sh  # Cycle de vie (cf. §5)
├── apps/polaris/                 # Apache Polaris — catalogue Iceberg (métadonnées)
│   ├── docker-compose.yml        # polaris + polaris-bootstrap (relational-jdbc → Postgres Supabase)
│   ├── sql/01-init-cluster.sql   # Rôle + base `polaris` dans le Postgres Supabase (idempotent)
│   ├── sql/02-init-database.sql  # Schéma applicatif + search_path de la base `polaris`
│   └── run.sh / setup.sh / reset.sh / update.sh  # Cycle de vie (cf. §5)
├── apps/supabase/                # Stack Supabase self-hosted (dépôt officiel supabase/docker)
│   ├── docker-compose.yml         # Stack de base (Envoy = gateway par défaut ; Kong en override)
│   ├── docker-compose.*.yml      # Overrides : kong, nginx, caddy, pgbouncer, pg17, s3...
│   ├── run.sh                    # Cycle de vie du stack (start/stop/logs/secrets/config)
│   ├── setup.sh                  # Bootstrap première installation (génère .env + clés)
│   ├── sql/01-parusdb-app.sql    # Schémas métier + RLS + seed ParusDB (idempotent, cf. §9)
│   ├── volumes/db/               # Données + SQL d'initialisation
│   └── CONFIG.md                 # Référence des variables d'environnement self-hosted
└── apps/trino/                   # Trino — moteur SQL du lakehouse (Iceberg REST → Polaris)
    ├── docker-compose.yml        # trino (réseau externe supabase_default)
    ├── catalog/                  # Bindings iceberg : un <catalogue>.properties par catalogue Polaris,
    │                              # générés par setup.sh (catalogues par défaut + système) ou l'app
    │                              # (aucun fichier statique commité, cf. §10)
    └── run.sh / setup.sh / reset.sh / update.sh  # Cycle de vie (cf. §5)
```

Un `AGENTS.md` imbriqué peut être ajouté dans `apps/nextjs/` ou `apps/supabase/` lorsque les
règles locales deviennent volumineuses ; il prime alors sur celui-ci pour son périmètre.

## 5. Environnement et commandes

**Prérequis** : Node.js LTS, npm, Docker + plugin Compose ; pour `apps/ollama`,
NVIDIA Container Toolkit (runtime `nvidia`) — voir `apps/ollama/README.md`.

| Action | Commande |
|---|---|
| **Installer toute la stack** | `sh setup.sh` (à la racine) — orchestre les apps dans l'ordre des dépendances, applique le SQL applicatif, expose les schémas PostgREST, resynchronise `apps/nextjs/.env.local` (clés Supabase, credentials Polaris, clé de chiffrement) sans les afficher, puis vérifie dlt |
| **Démarrer / arrêter toute la stack** | `sh run.sh start` / `sh run.sh stop` (à la racine) — ordre des dépendances ; `status`, `logs <app> [service]`, ciblage par app : `sh run.sh start polaris trino` |
| **Désinstaller tout** | `sh reset.sh` (destructif : conteneurs, volumes, données, `.env` → `.env.old` ; `--purge-images` pour retirer aussi les images) |
| Installer le frontend | `cd apps/nextjs && npm install` |
| Dev frontend (http://localhost:3000) | `cd apps/nextjs && npm run dev` |
| Build de production | `cd apps/nextjs && npm run build` |
| Lint | `cd apps/nextjs && npm run lint` |
| Typecheck | `cd apps/nextjs && npx tsc --noEmit` |
| Démarrer le stack Supabase | `cd apps/supabase && sh run.sh start` (alias `docker compose up -d`) |
| Logs / statut du stack | `sh run.sh logs [service]` / `sh run.sh status` |
| Secrets du stack | `sh run.sh secrets` — **ne jamais copier le contenu dans une PR, un log ou une conversation** |
| Démarrer Polaris (catalogue Iceberg) | `cd apps/polaris && sh setup.sh` (première fois), puis `sh run.sh start` |
| Démarrer Trino (moteur SQL) | `cd apps/trino && sh setup.sh` (première fois), puis `sh run.sh start` — Polaris doit être démarré |
| Démarrer mcp-trino (serveur MCP) | `cd apps/mcp-trino && sh setup.sh` (première fois), puis `sh run.sh start` — Trino doit être démarré |
| Démarrer Ollama (LLM local GPU) | `cd apps/ollama && sh setup.sh` (première fois : GPU vérifié + modèles), puis `sh run.sh start` |
| Démarrer dlt (moteur ELT) | `cd apps/dlt && sh setup.sh` (première fois), puis `sh run.sh start` — Supabase et Polaris doivent être démarrés |
| Vérifier dlt (runner, Postgres, Polaris) | `cd apps/dlt && sh run.sh verify` |
| Source de démo (validation e2e ELT) | `cd apps/dlt/demo && docker compose up -d --wait` — PostgreSQL bidon (seed inclus) |
| Test e2e Chat IA | `cd apps/ollama && sh run.sh test` — question → LLM → mcp-trino → Trino → réponse |
| Appliquer le schéma applicatif (idempotent) | `docker exec -i supabase-db psql -U supabase_admin -d postgres < apps/supabase/sql/01-parusdb-app.sql` |
| Réinitialiser Polaris / Trino / mcp-trino | `sh reset.sh` dans le dossier correspondant (destructif : métadonnées Polaris + `.env`) |
| Réinitialiser Ollama | `sh reset.sh` (destructif : conteneurs + modèles téléchargés + `.env`) |

**Leçon d'expérience (reset sans sudo)** : les fichiers des volumes bind-mountés
(`volumes/db/data`, `volumes/storage`, `volumes/ollama`) sont écrits par les
conteneurs et appartiennent à root — un `rm -rf` utilisateur échoue
(« Permission non accordée »). Les `reset.sh` de supabase et ollama les suppriment
donc via un conteneur éphémère `busybox` ; si cette approche est retirée, il faut
`sudo rm -rf` à la main (incident réel).

Le frontend utilise **npm** (`package-lock.json`). Ne pas introduire pnpm/yarn ni éditer les
lockfiles à la main.

**Variables d'environnement :**

- Le frontend lit `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  (voir `apps/nextjs/.env.example`). Tout préfixe `NEXT_PUBLIC_` est exposé au navigateur :
  n'y mettre **jamais** de secret.
- Le frontend lit aussi des variables **serveur uniquement** :
  `SUPABASE_SERVICE_ROLE_KEY`, `PARUSDB_ENCRYPTION_KEY`, `TRINO_URL`,
  `TRINO_USER`, `TRINO_CATALOG_DIR`, `POLARIS_API_URL`,
  `POLARIS_ROOT_CLIENT_ID/SECRET`, `OLLAMA_URL`, `MCP_TRINO_URL`… — la liste
  commentée vit dans `apps/nextjs/.env.example`. Les secrets s'importent des
  `.env` des stacks **sans jamais les afficher** (une commande `sed`/`grep`
  qui copie la valeur aveuglément, pas un copier-coller dans un terminal).
- Ajouter toute nouvelle variable aux `.env.example` **et** aux `.env` locaux ; les `.env` sont
  gitignorés — **ne jamais commiter de secret, de clé, de mot de passe** (y compris dans
  l'historique, les commentaires, les captures).
- Le stack self-hosted se configure via `apps/supabase/.env` (généré par `setup.sh`) ;
  référence complète : `apps/supabase/CONFIG.md`.
- Polaris et Trino se configurent via `apps/polaris/.env` et `apps/trino/.env`
  (générés par leurs `setup.sh`, qui importent credentials RustFS et port Postgres
  depuis `apps/supabase/.env`). Polaris utilise le Postgres et le RustFS **de la stack
  Supabase** ; aucun service de données supplémentaire n'est démarré.
- Ollama et mcp-trino se configurent via `apps/ollama/.env` et `apps/mcp-trino/.env`
  (générés par leurs `setup.sh`). Ollama requiert le NVIDIA Container Toolkit sur l'hôte
  (voir `apps/ollama/README.md`) ; mcp-trino rejoint le réseau `supabase_default` et
  reste en **lecture seule** sur Trino (`TRINO_ALLOW_WRITE_QUERIES=false`).

## 6. Règles transversales

- **Langue** : UI, libellés, messages d'erreur et documentation en français ; identifiants de
  code (fichiers, variables, fonctions, tables SQL) en anglais, `snake_case` pour la base,
  `camelCase` pour le TS.
- **TypeScript strict** (déjà actif) : pas de `any` ; pas de `@ts-ignore` sans justification en
  commentaire ; typer les frontières (réponses API, params de Server Actions).
- **Pertinence des imports** : n'ajouter une dépendance que si elle est justifiée ; préférer
  les primitives du framework. Toute nouvelle dépendance majeure se justifie dans la PR.
- **Diff minimal** : ne pas toucher ce qui n'est pas demandé ; pas de reformattage de fichiers
  entiers ; pas de renommages en cascade non sollicités.
- **Pas d'emoji dans l'UI** — uniquement des icônes `lucide-react` (voir §8).
- **Vérification systématique** : avant de déclarer un travail terminé, exécuter
  `npm run lint`, `npx tsc --noEmit` et `npm run build` dans `apps/nextjs` (et les tests dès
  qu'ils existent, voir §13).
- **Erreurs** : après 2 échecs consécutifs sur une même approche, changer de stratégie ou
  escalader — ne pas boucler.

## 7. Frontend — Next.js (App Router)

Stack : Next.js 16 (App Router, React 19), `cacheComponents: true`, proxy à la racine de
l'app.

**Règles :**

- **Server Components par défaut** : `"use client"` uniquement pour l'état, les effets, les
  handlers ou les APIs navigateur. Le fetching de données se fait côté serveur (RSC, Route
  Handlers, Server Actions).
- **Ne pas désactiver `cacheComponents`** (Next 16). Marquer explicitement les données
  dynamiques ; les sessions Supabase rendent les pages auth dynamiques naturellement.
- **`proxy.ts`, pas `middleware.ts`** : le refresh de session vit dans `apps/nextjs/proxy.ts`
  → `lib/supabase/proxy.ts`. Conserver le matcher existant.
- **Clients Supabase** : utiliser les helpers existants de `lib/supabase/` —
  `client.ts` (navigateur), `server.ts` (RSC/Actions/Route Handlers). Créer un client par
  requête, jamais de singleton global (contrainte Fluid compute).
- **Auth côté serveur uniquement** : toute décision d'accès vérifie la session côté serveur
  (`getUser()`) ; ne jamais se fier à l'état côté client pour autoriser quoi que ce soit.
- **Route protection** : layouts/pages protégées redirigent vers `/auth/login` côté serveur ;
  les données sensibles ne transitent que par RSC/Server Actions.
- **Server Actions** pour les mutations ; valider les entrées ; rediriger/`revalidate`
  explicitement après mutation.
- Nouvelles routes : dossiers cohérents avec la nav de la spec (`chat`, `agents`,
  `data-lakehouse`, `connectors`, `admin` — noms anglais dans le code, libellés
  français dans l'UI).
- `metadata` en français, titre de référence : « ParusDB — Plateforme Data Analytique
  IAgentique Open Source » ; `lang="fr"` sur `<html>`.

**Conventions de l'implémentation actuelle (leçons de la mise en place) :**

- **Pages à session = dynamiques** : avec `cacheComponents`, toute page lisant les
  cookies doit exporter `export const instant = false` (layout `(app)` **et** chaque
  page) — sinon le build échoue en « uncached or runtime data during
  prerendering » et le dev affiche l'erreur à chaque navigation.
- **Multi-schémas PostgREST** : les accès passent par `supabase.schema('<schéma>')`
  (en-têtes `Accept-Profile`/`Content-Profile`) ; les schémas doivent être listés
  dans `PGRST_DB_SCHEMAS` (cf. §9), sinon PGRST205 « Could not find the table ».
  **Jointures cross-schema** : la syntaxe `table(colonnes)` dans un `select()` ne
  joint pas une table d'un autre schéma exposé — faire deux requêtes séparées
  (ex. `chat.conversations` → `agents.agents`).
- **Erreurs PostgREST silencieuses** : toujours vérifier `error` d'une requête avant
  d'utiliser `data` — un `data ?? []` masque les échecs (PGRST200/205) et rend une
  page silencieusement vide (cas réel : `/chat` affichait « aucune conversation »
  alors que l'embedding cross-schema échouait en 400).
- **Session et RBAC** : helpers de `lib/session.ts` (`requireSession`,
  `requirePermission` → redirection serveur) ; les Server Actions sont colocalisées
  par feature (`actions.ts`), valident les entrées et `revalidate` explicitement.
  Le client administrateur (`lib/supabase/admin.ts`, service_role) reste serveur
  uniquement.
- **Onboarding premier démarrage** (`/auth/onboarding`, spec §Onboarding) : tant
  qu'aucun compte n'existe (`lib/onboarding.ts` → `isFirstInstall()`), login et
  sign-up redirigent vers l'onboarding ; la Server Action
  (`app/auth/onboarding/actions.ts`) crée le compte via l'API admin
  (`email_confirm: true`, pas de lien email), attribue explicitement le rôle
  `admin` (le trigger `iam.on_auth_user_created` reste le filet de sécurité des
  sign-up normaux) et ouvre la session. **La condition « aucun compte » est
  revérifiée dans l'action** (jamais seulement dans la page) : sinon n'importe
  qui pourrait se créer administrateur une fois la plateforme peuplée. Pages
  `instant = false` (état de première installation dynamique).
- **eslint react-hooks v6 (incluse dans eslint-config-next 16)** : `setState`
  synchrone dans un `useEffect` est une **erreur** — hydratation via
  `useSyncExternalStore` (pattern `useIsHydrated`), restaurations de stockage
  externe (sessionStorage) via `requestAnimationFrame` dans l'effet. Idem pour
  `Date.now()` dans le rendu : l'extraire dans une fonction hors composant.
- **eslint-config-next ≥ 16** expose des flat configs natives
  (`eslint-config-next/core-web-vitals`, `/typescript`) — ne plus utiliser
  `FlatCompat` (erreur « circular structure »).
- **shadcn actuel** : les composants générés importent `cn` via un alias tsconfig
  (`"cn": ["./lib/utils.ts"]`) ; composants ajoutés uniquement via
  `npx shadcn@latest add`, jamais édités à la main.

## 8. Design system — Tailwind CSS + shadcn/ui + charte « Mésange Charbonnière »

> **Obligatoire avant tout écran** : lire `docs/functional/brand_guidelines.md` en entier.

**État actuel (à corriger en premier)** : le template est en Tailwind CSS **v3**
(`tailwind.config.ts`, variables HSL, thème shadcn neutre, police Geist). La charte cible
Tailwind CSS **v4** (tout dans le CSS, pas de `tailwind.config.ts`). Le premier travail UI est
donc : migrer en v4, remplacer `globals.css` par la section 3 de la charte **à l'identique**
(tokens, base, utilitaires `yolk-stripe`/`grid-bg`), installer les polices via `next/font`
(Inter, Space Grotesk, JetBrains Mono — graisses exactes de la charte §4, setup charte §9.1),
remplacer
`tailwindcss-animate` par `tw-animate-css`, et mettre à jour `components.json`
(baseColor `slate`, `cssVariables: true`).

**Règles permanentes :**

- **Palette de marque** : `jaune #FFD700` (primary, CTA, focus, sélection — jamais texte sur
  fond clair, jamais fond de page), `charbon #1A1A1A`, `cendre #3A3A3A`, `blanc cassé #F5F5F5`,
  `olive #6B8E23` (accents), `bleu data #2E86C1` (catégorisation), `destructive #B23A48`
  (jamais le rouge Tailwind `#ef4444`). Répartition ≈ 60 % neutres / 30 % structure / ≤ 10 %
  jaune.
- **Zéro hex codé en dur dans les composants** : utiliser les tokens sémantiques
  (`bg-primary`, `text-muted-foreground`, `bg-card`…) ou les utilitaires de marque
  (`bg-jaune`, `text-olive`…). Seules ombres/motifs documentés dans la charte admettent des
  valeurs littérales.
- **Focus toujours jaune** (`--ring: #FFD700`) ; `::selection` jaune/charbon ; le texte sur
  jaune est toujours `charbon`.
- **Typographie** : Inter (corps), Space Grotesk (`h1`–`h4`, chiffres), JetBrains Mono (code,
  eyebrows, labels techniques). Pas de 4e police, pas de graisses hors charte.
- **Rayons** : cartes `rounded-3xl`, boutons shadcn `rounded-md` (pilules uniquement pour les
  CTA marketing/auth). Pas de cards carrées ni de rayons > `3xl`.
- **Motifs signature** : sections « moments forts » (login, empty states, onboarding) =
  charbon + `grid-bg` + halo jaune radial.
- **Logo de marque** : `apps/nextjs/public/parusdb-logo.jpg` (JPEG fond blanc, marges
  rognées), servi par `ParusLogo` (`components/parus/logo.tsx`). Emplacement unique :
  en-tête de la sidebar, pleine largeur, coins supérieurs collés au sommet du
  menu (pas de padding au-dessus), lien « Accueil » vers `/chat` — jamais dans les
  états vides, les écrans d'authentification ni le contenu principal. Favicon :
  `app/favicon.ico`.
- **Interactions** : hover = soulèvement `-translate-y-*` + transition douce ; pas de scale
  agressif ni d'animation flashy ; lucide `strokeWidth` 1.6–1.8.
- **Dark mode** : via `next-themes` (`attribute="class"`), inversion charbon/blanc cassé
  uniquement ; jaune et olive invariants. Sélecteur Dark/Light/System en bas à gauche.
- **shadcn/ui** : ajouter les composants via `npx shadcn@latest add` ; ne jamais éditer à la
  main les fichiers de `components/ui/` (régénérés par le CLI) ; les compositions
  applicatives vivent dans `components/` avec `cn()` de `lib/utils`.
- **Ton éditorial** : direct, factuel, français ; boutons à l'impératif (« Connecter une
  source ») ; erreurs actionnables (« La connexion a échoué : clé API invalide »), jamais
  « Oups ! ».
- **Avant de livrer un écran** : passer la checklist de conformité de la charte (§14) — elle
  fait partie de la definition of done (§13).

## 9. Backend — Supabase (PostgreSQL) self-hosted

Stack self-hosted `self-hosted/v0.8.2` (Envoy par défaut, Kong en override
`sh run.sh config add kong`, backend S3 via `docker-compose.rustfs.yml` — cible **RustFS**).
L'installation ParusDB tourne avec l'override **Kong activé** (gateway `supabase-kong`
sur le port 8000, même port qu'Envoy) : après un `reset.sh` qui régénère `apps/supabase/.env`,
le réactiver (`sh run.sh config add kong` puis `sh run.sh start`), sinon la gateway
revient en Envoy.

**Règles :**

- **Overrides S3 à enregistrer sur chaque installation** : `sh run.sh config add rustfs`
  (backend S3 du storage) **et** `sh run.sh config add rustfs-restart` — l'override ParusDB
  `docker-compose.rustfs-restart.yml` ajoute `restart: unless-stopped` au service `rustfs`,
  que le vendor ne définit pas : sans lui, RustFS ne revient pas après un reboot machine et
  le storage Supabase + tout le lakehouse restent silencieusement cassés. Ne jamais éditer
  les fichiers vendor (ils sont 3-way mergés par `update.sh`) : les correctifs locaux se
  posent en fichiers d'override ParusDB enregistrés dans `COMPOSE_FILE`.

- **Skills obligatoires** : charger `.agents/skills/supabase/SKILL.md` (checklist sécurité :
  JWT, clés, RLS, vues) **et** `supabase-postgres-best-practices/SKILL.md` (règles préfixées
  `query-`, `conn-`, `security-`, `schema-`, `lock-`, `data-`, `monitor-`, `advanced-` dans
  `references/`) **avant** toute tâche base/auth/SQL. Ne pas se fier à ses souvenirs :
  Supabase évolue vite, vérifier le changelog.
- **Schéma versionné** : toute modification DDL passe par un fichier SQL versionné et
  idempotent (init du stack dans `apps/supabase/volumes/db/` ou migration dédiée). Jamais de
  modification manuelle via Studio sans fichier SQL commité. Le schéma applicatif ParusDB
  vit dans `apps/supabase/sql/01-parusdb-app.sql` (schémas `iam`, `agents`, `chat`,
  `lakehouse`, `connectors`, `admin`) : à appliquer sur une base déjà
  initialisée avec la commande du §5, relançable sans risque.
- **Exposition PostgREST des schémas métier** : chaque schéma consulté par le frontend
  doit être ajouté à `PGRST_DB_SCHEMAS` dans `apps/supabase/.env` puis le conteneur
  recréé (`docker compose up -d rest`) — sinon PostgREST répond PGRST205 « Could not
  find the table » même si la table existe (une modification du `.env` exige une
  recréation, pas un simple restart). Ajouter aussi la ligne au `.env` après tout
  `reset.sh`. Le `setup.sh` à la racine fait ce correctif automatiquement après
  chaque réinstallation — un reset suivi d'un setup à la main sans repasser par
  le script racine exige de rejouer l'étape (sinon : connexion en échec
  « Aucun rôle attribué au compte », incident réel post-reset).
- **Supabase Realtime** : une table ne peut être diffusée que si elle appartient à la
  publication `supabase_realtime` (voir le bloc idempotent de `01-parusdb-app.sql`
  pour `chat.stream_events`) ; les abonnés passent par la RLS de la table avec leur
  JWT — les politiques doivent couvrir le `SELECT`.
- **RLS partout** : chaque table d'un schéma exposé (dont `public`) active RLS + politiques
  réelles. `TO authenticated` seul ne suffit pas (BOLA) : toujours combiner avec un prédicat
  d'appartenance. `UPDATE` requiert une politique `SELECT` + `WITH CHECK`. `auth.role()` est
  déprécié → clause `TO`. Vues : `security_invoker = true`. Les permissions applicatives
  s'évaluent via `iam.has_permission(auth.uid(), '<permission>')` (SECURITY DEFINER, dans un
  schéma non exposé à l'anonyme) ; les fonctions SQL standard sont validées **à la
  création** — les définir après les tables qu'elles lisent.
- **Autorisation** : jamais `raw_user_meta_data` (éditable par l'utilisateur) pour des décisions
  d'autorisation → `raw_app_meta_data`. Les rôles applicatifs ParusDB (admin/technique/métier,
  rôles multiples, rôle actif) vivent dans des tables applicatives (`iam.roles`,
  `iam.user_roles`, `iam.user_active_role`), pas dans les JWT claims éditables. Le trigger
  `iam.on_auth_user_created` attribue `admin` au premier compte créé, `metier` aux suivants.
- **Clés** : côté client uniquement la **publishable key**. La clé `service_role` (et tout
  secret) ne sort jamais du serveur. Jetons d'accès scopés pour scripts/CI.
- **Vérifier après correction** : une modification SQL se vérifie par une requête de test ;
  un fix non vérifié est incomplet. Pattern de test RLS : `SET ROLE authenticated` +
  `select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', false)`
  puis les requêtes à vérifier, `RESET ROLE`.

## 10. Data Lakehouse — Apache Polaris + Trino + RustFS S3

**Règles :**

- **Rôles stricts** : RustFS = object storage brut ; Polaris = catalogue de métadonnées
  (catalogues → schémas/namespaces → tables Iceberg) ; Trino = unique moteur SQL de requêtage.
  L'app n'écrit jamais directement dans S3 ; l'écriture de données passe par les pipelines dlt
  (§12), la lecture par Trino.
- **Nommage** : identifiants en minuscules `snake_case` (catalogues, schémas, tables, colonnes) ;
  catalogues par environnement (ex. `prod`, `dev`, `stg`), schémas par domaine
  (`customers`, `products`…). Pas de caractères spéciaux ni de casse mixte.
- **Séparation des responsabilités** : aucune donnée analytique dans PostgreSQL applicatif,
  aucun état transactionnel applicatif dans Iceberg.
- **Éditeur SQL** (spec §Data Lakehouse) : coloration syntaxique, onglets, exécution, résultats,
  explorateur schémas → tables → colonnes. Toute requête exécutée par un utilisateur passe par
  les droits de son **rôle actif** (RBAC applicatif, permissions granulaires par catalogue).
- **Destructif** : suppression d'un catalogue = confirmation admin + **ressaisie du nom**
  (action irréversible). Pattern obligatoire pour toute suppression cascade (catalogue,
  pipeline…).
- **Catalogue vide** : proposer la création d'un premier connecteur avec redirection vers
  « Connecteurs ».
- Credentials S3/Polaris : jamais en dur ; chiffrés au repos côté serveur.
- **Documentation opérationnelle** : cycle de vie, architecture et pièges d'intégration
  Polaris 1.8.0 (rôle `supabase_admin` pour le DDL, schéma `polaris_schema` pré-créé,
  grant `CATALOG_MANAGE_CONTENT` sur `catalog_admin`, purge au DROP, clés RSA du token
  broker persistées) sont consignés dans `apps/polaris/README.md` et
  `apps/trino/README.md` — les lire avant de modifier `setup.sh`, `docker-compose.yml`
  ou le SQL d'init d'une des deux apps.

**Implémentation actuelle (leçons de la mise en place) :**

- **Client Trino** : l'app consomme Trino via le client officiel **trino-js-client**
  (`lib/trino.ts`, npm `trino-client` ; `@trinodb/trino-js-client@1.0.0` exige Node ≥ 24,
  la machine tourne en Node 22 — renommer la dépendance lors de la montée). Itérer les
  pages du résultat et remonter `QueryResult.error` en erreur applicative.
- **Catalogues via l'API Management Polaris** (`lib/polaris.ts`, spec 1.8.0) : jeton OAuth2
  client credentials (scope `PRINCIPAL_ROLE:ALL`, endpoint `/api/catalog/v1/oauth/tokens`),
  `createCatalog` au format `CreateCatalogRequest` + grant `CATALOG_MANAGE_CONTENT` au
  format `AddGrantRequest {grant: GrantResource}`, `listCatalogs` **sans** paramètre de
  pagination (absent de la spec). **La suppression n'a pas de paramètre `purgeRequested`
  en 1.8.0** : purger le contenu par `DROP TABLE`/`DROP SCHEMA` Trino (la propriété
  `polaris.config.drop-with-purge.enabled` est posée à la création) puis `DELETE`
  du catalogue.
- **Isolation des `allowedLocations` par catalogue** : chaque catalogue a
  `allowedLocations: ["s3://<bucket>/<nom>"]` (sous-répertoire isolé). Polaris rejette
  la création si une location est préfixe d'un catalogue existant (HTTP 400
  `ValidationException`). Le catalogue par défaut d'une installation antérieure peut
  avoir `allowedLocations` = bucket entier : l'app corrige automatiquement via
  `ensureDefaultCatalogIsolated()` (PUT `/catalogs/<nom>` — **le body doit contenir
  `currentEntityVersion`**, champ `entityVersion` du GET). **`GET /catalogs/<nom>`
  retourne l'objet catalogue directement** (pas d'enveloppe `{catalog: ...}`, seul le
  listage enveloppe en `{catalogs: [...]}`) : lire `.catalog` dans la réponse rend la
  correction silencieusement inopérante (bug corrigé). Le flag
  `POLARIS_FEATURES_ALLOW_OVERLAPPING_CATALOG_URLS=true` dans le docker-compose Polaris
  sert de filet de sécurité le temps de la correction ; un changement d'`environment`
  du compose n'est effectif qu'après **recréation** du conteneur (`sh run.sh start`),
  pas un simple restart.
- **Bindings Trino** : un catalogue Polaris = un fichier `catalog/<nom>.properties` —
  le nom du fichier (donc du catalogue Trino) est **toujours le nom du catalogue
  Polaris** : on requête `SELECT … FROM dev.<schéma>.<table>`, jamais
  `FROM polaris…`. Aucun fichier statique commité (`apps/trino/catalog/*.properties`
  est gitignoré) : le setup de Trino génère les bindings du catalogue système
  (`POLARIS_SYSTEM_CATALOG`, ex. `parusdb`) et du catalogue par défaut
  (`POLARIS_CATALOG_NAME`, ex. `dev`) ; l'app génère celui des nouveaux catalogues
  (`TRINO_CATALOG_DIR`) mais **Trino ne le charge qu'au redémarrage**
  (`cd apps/trino && sh run.sh restart`) — l'UI doit l'indiquer.
- **Catalogues d'installation** : `apps/polaris/setup.sh` crée le catalogue
  **système** (`parusdb` — usage libre : administration de la plateforme,
  l'équivalent de la base `snowflake` de Snowflake) **puis** le catalogue
  d'**environnement** par défaut (`dev`). Leurs descriptions et le RBAC vivent
  dans le seed `apps/supabase/sql/02-lakehouse-catalogs.sql` (appliqué par le
  `setup.sh` racine, idempotent) — Polaris reste la source de vérité des
  catalogues, le registre applicatif ne porte que description et accès.
- **Métriques disque** : tailles et nombres de fichiers via les tables metadata Iceberg
  `"<catalog>"."<schéma>"."<table>$files"` (identifiants à quoter).
- **RBAC applicatif par catalogue** : `lakehouse.catalog_access` (rôles ↔ catalogues,
  alimenté à la création pour les rôles ayant la permission `lakehouse`). L'éditeur SQL
  s'exécute sous l'utilisateur Trino unique : le RBAC porte sur la visibilité des
  catalogues et l'accès aux pages, pas sur des rôles Trino distincts (limitation
  assumée, à documenter dans les PR concernées). **Fallback** : la page agent lit
  `catalog_registry` + `catalog_access` ; si `catalog_access` est vide pour le rôle
  actif (catalogues créés avant la mise en place de la table), tous les catalogues
  du registre sont proposés.

## 11. Chat IA — Ollama + mcp-trino

**Déploiement en place** : `apps/ollama` (serveur d'inférence GPU, modèle par défaut
`gemma4:e2b`, function calling natif) et `apps/mcp-trino` (endpoint MCP Streamable HTTP
`http://localhost:8185/mcp`, lecture seule, schémas autorisés bornés par
`TRINO_ALLOWED_SCHEMAS`). Le test e2e `sh run.sh test` (apps/ollama) valide le parcours
complet : question métier → exploration du lakehouse → SQL exécuté → réponse restituée.

**Règles :**

- **Un seul chemin LLM ↔ données : mcp-trino.** Le modèle ne reçoit jamais de chaîne de
  connexion ni de secret ; il choisit le catalogue, écrit le SQL, restitue des résultats
  sourcés via les outils MCP exposés.
- **Configuration des agents** (spec §Agents IA) : nom, description, modèle LLM, prompt
  système, sources (catalogues/schémas autorisés par le rôle actif), propriétaire. Stockée
  dans PostgreSQL ; les prompts système sont des données, pas du code.
- **Modèles** : open source (Mistral, Qwen…) via Ollama local, ou fournisseurs externes
  (OpenAI, Anthropic, Mistral, compatible OpenAI) par clé API configurée en
  administration (`/admin/providers`) — clé **masquée** dans l'UI, chiffrée au
  repos, jamais renvoyée au client. Les modèles ne sont pas stockés : ils sont
  découverts dynamiquement via l'API de listing du fournisseur
  (`lib/providers.ts`). Un agent référence une **source** (« Ollama (local) »
  ou l'id d'un fournisseur, `agents.model_provider`) et un modèle découvert.
- **Conversations** : propriétaire = créateur (visible par lui seul) ; agent **immuable** après
  création de la conversation ; titre généré par l'IA à partir des 2 premiers échanges ;
  messages utilisateur à droite, agent à gauche, bulles selon la charte (§8.2 : agent =
  fond charbon, code SQL en jaune).
- **Streaming** : diffusion temps réel via Supabase Realtime.
- **Traçabilité sans fuite** : journaliser métadonnées (durée, modèle, coût en tokens) mais
  jamais les secrets ; les prompts des utilisateurs sont des données personnelles (RGPD) —
  pas de transmission à des tiers hormis le LLM configuré.

**Implémentation actuelle (leçons de la mise en place) :**

- **Transport Realtime concret** : le BFF (`app/(app)/chat/[id]/stream/route.ts`) insère
  une ligne `chat.stream_events` par évènement (`status`, `tool`, `tool_result`,
  `token`, `done`, `error`) ; le navigateur s'abonne via `postgres_changes` filtré par
  conversation et **attend `SUBSCRIBED` avant d'envoyer** (aucun replay : un abonnement
  tardif perd les évènements) ; la réponse HTTP porte le texte final en filet de
  sécurité. Les évènements sont purgés au message suivant (transitoires).
- **Client MCP dans le BFF** (`lib/mcp.ts`) : Streamable HTTP porté du script e2e —
  handshake `initialize` → `notifications/initialized` → `tools/list` → `tools/call`,
  `Mcp-Session-Id` par message, réponses SSE à parser ligne à ligne.
- **Boucle agentique** (`lib/agent-runner.ts`) : historique normalisé + `tools`,
  max 8 allers-retours (`PARUSDB_AGENT_MAX_STEPS`). Le prompt socle impose le français,
  l'exploration avant exécution, et documente la syntaxe Trino des dates relatives
  (`date_add('month', -3, current_date)`) : sans cet indice, `gemma4:e2b` tente des
  syntaxes inexistantes — un LLM peut échouer de façon non déterministe, toujours
  rejouer un test e2e chat avant de conclure.
- **Backends LLM normalisés** (`lib/llm.ts`) : Ollama, compatible OpenAI
  (OpenAI, Mistral, endpoints personnalisés) et Anthropic partagent la même
  interface (`chat(model, messages, tools)`) ; la route de stream résout le
  backend depuis la source de l'agent (`resolveProviderBackend`, clé
  déchiffrée en mémoire serveur uniquement). Les ids d'appels d'outils sont
  conservés entre les tours (`tool_call_id`) : OpenAI/Anthropic les exigent
  sur les résultats d'outils, Ollama se contente du nom. Piège Ollama : au
  renvoi d'un message assistant, `tool_calls[].function.arguments` doit être
  un **objet** (une chaîne JSON est rejetée en HTTP 400 « Value looks like
  object, but can't find closing '}' symbol »). Piège modèles de raisonnement
  (ex. `zai-glm` via Mistral) : `message.content` arrive en **tableau de
  blocs** `{type:"thinking"|"text"}` — ne retenir que les blocs texte
  (`normalizeContent` dans `lib/llm.ts`), sinon la réponse n'est pas une
  chaîne et fait planter le traitement en aval.
- **Sources par clé API** : clés configurées et chiffrées en administration
  (`admin.providers`), validées par un appel réel au fournisseur à l'ajout ;
  les conversations s'exécutent sur ces sources comme sur Ollama (backends
  `lib/llm.ts`, function calling via mcp-trino).
- **Le premier message** transite par **query param** (`?pending=<message>`) depuis
  « Nouveau chat » : la page RSC `/chat/[id]` lit `searchParams.pending` côté serveur
  et le passe en prop à `ConversationView`, qui l'envoie au montage. Plus fiable
  qu'un store mémoire (sessionStorage ou module-level) avec la navigation Next 16
  (`cacheComponents`). L'agent est scellé avant l'envoi.
- **Garde anti-double** : le texte final peut arriver par deux canaux (évènement
  Realtime `done` + filet de sécurité HTTP). `finalize()` vérifie
  `streamingRef.current` avant d'ajouter le message — un seul canal gagne.
- **Rendu des messages agent** (`components/chat/message-bubble.tsx`) : markdown
  complet via `react-markdown` + `remark-gfm`, coloration syntaxique par
  `rehype-highlight` (palette `.hljs-*` dans `globals.css`, classes/types en
  jaune — charte §8.2), retour à la ligne automatique dans les blocs de code
  (jamais de défilement horizontal dans une bulle), label du langage + bouton
  « Copier ». Le même rendu s'applique au texte en cours de streaming. La liste
  des messages défile sur toute la largeur du viewport — barre verticale au
  bord droit de l'écran (marges négatives annulant le padding du `<main>`),
  contenu contraint à `max-w-4xl` à l'intérieur.

## 12. ELT — dlt (data load tool)

**Règles :**

- **Pipelines génériques variabilisés** : un pipeline dlt paramétré par type de source
  (credentials, tables sélectionnées, destination, write mode) ; configuration stockée dans
  PostgreSQL, jamais dans le code.
- **Destination unique : le Data Lakehouse** (catalogue Polaris indiqué par l'utilisateur) ;
  destination de l'app, pas un paramètre libre.
- **Write modes** : `incremental` par défaut (création si absente, chargement du delta,
  cursor dlt) ; `replace` (toutes les données) explicite et signalé comme recréation complète.
- **Parcours de création** (spec §Connecteurs) : source → credentials avec bouton
  « Test connexion » (suivant désactivé tant que non validé) → sélection des tables + CRON →
  « Enregistrer » (sauvegarde + lancement immédiat).
- **Ordonnancement CRON** ; statuts : actif / inactif / erreur ; date de création et dernière
  exécution visibles ; actions Modifier / Supprimer / Lancer / Désactiver.
- Credentials des sources : chiffrés au repos, jamais exposés au client ni dans les logs
  d'exécution.

**Implémentation actuelle (leçons de la mise en place) :**

- **Le moteur dlt est intégré** (`apps/dlt`, architecture dans son README) :
  destination unique = table format **Iceberg** via pyiceberg → catalogue REST
  Polaris, données dans RustFS avec **credentials vendus** (aucune clé S3 de
  données dans le runner) ; un **conteneur jetable par exécution**, démarré
  par l'ordonnanceur `parus-dlt-scheduler` (runs `queued` + CRON croniter en
  UTC) ; état dlt persisté dans le volume `parus-dlt-state` (cursors).
- **Sources** : core `sql_database` (14 dialectes SQLAlchemy, pilotes
  psycopg2/pymysql/pymssql dans l'image), `rest_api` (endpoints),
  `filesystem`/readers (CSV/Parquet/JSONL) ; 29 sources verified vendues du
  dépôt officiel à un commit épinglé (pas de package PyPI) — 2 sources
  pilotées par code (scraping, unstructured_data) restent non exposées. Le
  registre machine (`sh run.sh catalog`) alimente `lib/sources.ts`.
- **Parcours réel** : « Test connexion » = introspection réelle dans un
  conteneur jetable (tables + colonnes + curseur suggéré, credentials par
  stdin, jamais persistés) ; « Enregistrer » / « Lancer » insèrent un run
  `queued` (statuts `queued/running/success/error`, origine
  `creation/manual/schedule`, journal d'erreur dans `pipeline_runs.log`).
- **Modes d'insertion** : `replace` = recréation complète ; `incremental` =
  curseur par table (colonne optionnelle suggérée par l'introspection) +
  **merge sur clé primaire** (upsert) quand la source en expose, sinon append.
- **Credentials** : chiffrés AES-256-GCM par le BFF, déchiffrés en mémoire par
  le runner (même `PARUSDB_ENCRYPTION_KEY` importée dans `apps/dlt/.env`),
  jamais stockés en clair (`source_config` ne porte que les curseurs) ;
  en édition, champs vides = conserver les valeurs chiffrées existantes.
- **Accès base du runner** : rôle PostgreSQL dédié `parus_dlt` (moindre
  privilège, politiques RLS `TO parus_dlt` dans `01-parusdb-app.sql`) — jamais
  service_role ; l'ordonnanceur démarre les conteneurs via le socket Docker
  de l'hôte (docker-py).

## 13. Qualité — definition of done

Une contribution est terminée quand :

1. `npm run lint`, `npx tsc --noEmit` et `npm run build` passent dans `apps/nextjs` ;
2. Le changement SQL est appliqué et vérifié par une requête de test (§9) ;
3. Toute requête/UX implémentée correspond à la spec fonctionnelle (§2) ;
4. Tout écran passe la checklist de conformité de la charte (§8 + charte §14) ;
5. Les messages d'erreur sont en français, factuels et actionnables.

**Tests** : aucun framework de test n'est encore installé. Dès la première brique fonctionnelle :
unitaire/intégration avec **Vitest + React Testing Library**, e2e des parcours critiques
(auth, création catalogue, pipeline) avec **Playwright**. Toute nouvelle fonctionnalité
s'accompagne de tests ; corriger un bug commence par un test qui le reproduit.

## 14. Git et conventions de contribution

- **Commits** : Conventional Commits — `feat`, `fix`, `docs`, `refactor`, `test`, `chore`,
  `perf`, `ci` — description en français à l'impératif.
  Exemple : `feat: création des catalogues du lakehouse`.
- **Aucune mention d'outil IA dans l'historique** : jamais de trailer
  « Generated by … », ni de ligne `Co-Authored-By:` citant un agent IA
  (Mistral Vibe ou autre) dans les messages de commit — l'auteur est le
  développeur, pas l'outil.
- **Branches** : `feat/<brique>-<sujet>` (ex. `feat/lakehouse-explorateur`),
  `fix/<sujet>`, `docs/<sujet>`. Pas de commit direct sur `main`.
- **PR** : une PR = un changement logique ; décrire le quoi/pourquoi, référencer la section de
  spec concernée, lister les vérifications effectuées (§13), signaler tout écart assumé aux
  docs (§2).
- **Jamais de push force** sans autorisation explicite ; `--force-with-lease` uniquement.
- Ne pas commiter : `.env`, secrets, build (`node_modules`, `.next`, volumes Docker).

---

*Ce fichier est une documentation vivante : le maintenir à jour à chaque évolution
structurelle du projet (nouvelle app dans le monorepo, changement de stack, nouvelle
convention).*
