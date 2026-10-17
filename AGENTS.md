# AGENTS.md — ParusDB

> Instructions de développement pour tout agent (IA ou humain) intervenant sur ce dépôt.
> À lire en entier avant la première modification. Les blocs « **Règles** » sont impératifs.
> Conforme à la convention [agents.md](https://agents.md/) : ce fichier est le point d'entrée
> agent ; les fichiers `AGENTS.md` imbriqués (sous-répertoires) priment sur celui-ci pour les
> fichiers qu'ils couvrent ; une instruction explicite de l'utilisateur dans la conversation
> prime sur ce fichier.

---

## 1. Le projet en une minute

**ParusDB** est une plateforme data analytique open source (licence **ELv2**) qui unifie :

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

**Avancement actuel** : seul le template Next.js + Supabase est en place et fonctionnel :
authentification complète (login, sign-up, forgot/update password, callback, logout), clients
Supabase SSR, shell d'application minimal. **Aucune brique produit n'est implémentée.**

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
├── docs/functional/              # Specs produit : fiche, fonctionnel, charte
├── .agents/skills/               # Skills officiels Supabase (voir §9)
│   ├── supabase/SKILL.md
│   └── supabase-postgres-best-practices/  # SKILL.md + references/*.md (règles par catégorie)
├── apps/nextjs/                  # Application Next.js 16 (App Router) — frontend + BFF
│   ├── app/                      # Routes uniquement (App Router)
│   ├── components/               # Composants applicatifs
│   │   └── ui/                   # Composants shadcn/ui générés par CLI (ne pas éditer à la main)
│   ├── lib/supabase/             # Clients Supabase SSR : client.ts, server.ts, proxy.ts
│   ├── proxy.ts                  # Proxy Next 16 (ex-middleware) : refresh de session
│   └── app/globals.css           # Tokens de design (cible : charte §3)
├── apps/polaris/                 # Apache Polaris — catalogue Iceberg (métadonnées)
│   ├── docker-compose.yml        # polaris + polaris-bootstrap (relational-jdbc → Postgres Supabase)
│   ├── sql/01-init-cluster.sql   # Rôle + base `polaris` dans le Postgres Supabase (idempotent)
│   ├── sql/02-init-database.sql  # Schéma applicatif + search_path de la base `polaris`
│   └── run.sh / setup.sh / reset.sh / update.sh  # Cycle de vie (cf. §5)
├── apps/supabase/                # Stack Supabase self-hosted (dépôt officiel supabase/docker)
│   ├── docker-compose.yml         # Stack de base (Envoy = gateway par défaut ; Kong en option)
│   ├── docker-compose.*.yml      # Overrides : kong, nginx, caddy, pgbouncer, pg17, s3...
│   ├── run.sh                    # Cycle de vie du stack (start/stop/logs/secrets/config)
│   ├── setup.sh                  # Bootstrap première installation (génère .env + clés)
│   ├── volumes/db/               # Données + SQL d'initialisation
│   └── CONFIG.md                 # Référence des variables d'environnement self-hosted
└── apps/trino/                   # Trino — moteur SQL du lakehouse (Iceberg REST → Polaris)
    ├── docker-compose.yml        # trino (réseau externe supabase_default)
    ├── catalog/polaris.properties # Catalogue iceberg : Polaris + credentials vendus
    └── run.sh / setup.sh / reset.sh / update.sh  # Cycle de vie (cf. §5)
```

Un `AGENTS.md` imbriqué peut être ajouté dans `apps/nextjs/` ou `apps/supabase/` lorsque les
règles locales deviennent volumineuses ; il prime alors sur celui-ci pour son périmètre.

## 5. Environnement et commandes

**Prérequis** : Node.js LTS, npm, Docker + plugin Compose.

| Action | Commande |
|---|---|
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
| Réinitialiser Polaris / Trino | `sh reset.sh` dans le dossier correspondant (destructif : métadonnées Polaris + `.env`) |

Le frontend utilise **npm** (`package-lock.json`). Ne pas introduire pnpm/yarn ni éditer les
lockfiles à la main.

**Variables d'environnement :**

- Le frontend lit `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  (voir `apps/nextjs/.env.example`). Tout préfixe `NEXT_PUBLIC_` est exposé au navigateur :
  n'y mettre **jamais** de secret.
- Ajouter toute nouvelle variable aux `.env.example` **et** aux `.env` locaux ; les `.env` sont
  gitignorés — **ne jamais commiter de secret, de clé, de mot de passe** (y compris dans
  l'historique, les commentaires, les captures).
- Le stack self-hosted se configure via `apps/supabase/.env` (généré par `setup.sh`) ;
  référence complète : `apps/supabase/CONFIG.md`.
- Polaris et Trino se configurent via `apps/polaris/.env` et `apps/trino/.env`
  (générés par leurs `setup.sh`, qui importent credentials RustFS et port Postgres
  depuis `apps/supabase/.env`). Polaris utilise le Postgres et le RustFS **de la stack
  Supabase** ; aucun service de données supplémentaire n'est démarré.

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
  `data-lakehouse`, `connectors`, `admin`, `support` — noms anglais dans le code, libellés
  français dans l'UI).
- `metadata` en français, titre de référence : « ParusDB — Plateforme Data Analytique
  IAgentique Open Source » ; `lang="fr"` sur `<html>`.

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
`sh run.sh config add kong`, backend S3 via `docker-compose.s3.yml` — cible **RustFS**).

**Règles :**

- **Skills obligatoires** : charger `.agents/skills/supabase/SKILL.md` (checklist sécurité :
  JWT, clés, RLS, vues) **et** `supabase-postgres-best-practices/SKILL.md` (règles préfixées
  `query-`, `conn-`, `security-`, `schema-`, `lock-`, `data-`, `monitor-`, `advanced-` dans
  `references/`) **avant** toute tâche base/auth/SQL. Ne pas se fier à ses souvenirs :
  Supabase évolue vite, vérifier le changelog.
- **Schéma versionné** : toute modification DDL passe par un fichier SQL versionné et
  idempotent (init du stack dans `apps/supabase/volumes/db/` ou migration dédiée). Jamais de
  modification manuelle via Studio sans fichier SQL commité.
- **RLS partout** : chaque table d'un schéma exposé (dont `public`) active RLS + politiques
  réelles. `TO authenticated` seul ne suffit pas (BOLA) : toujours combiner avec un prédicat
  d'appartenance. `UPDATE` requiert une politique `SELECT` + `WITH CHECK`. `auth.role()` est
  déprécié → clause `TO`. Vues : `security_invoker = true`.
- **Autorisation** : jamais `raw_user_meta_data` (éditable par l'utilisateur) pour des décisions
  d'autorisation → `raw_app_meta_data`. Les rôles applicatifs ParusDB (admin/technique/métier,
  rôles multiples, rôle actif) vivent dans des tables applicatives, pas dans les JWT claims
  éditables.
- **Clés** : côté client uniquement la **publishable key**. La clé `service_role` (et tout
  secret) ne sort jamais du serveur. Jetons d'accès scopés pour scripts/CI.
- **Vérifier après correction** : une modification SQL se vérifie par une requête de test ;
  un fix non vérifié est incomplet.

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

## 11. Chat IA — Ollama + mcp-trino

**Règles :**

- **Un seul chemin LLM ↔ données : mcp-trino.** Le modèle ne reçoit jamais de chaîne de
  connexion ni de secret ; il choisit le catalogue, écrit le SQL, restitue des résultats
  sourcés via les outils MCP exposés.
- **Configuration des agents** (spec §Agents IA) : nom, description, modèle LLM, prompt
  système, sources (catalogues/schémas autorisés par le rôle actif), propriétaire. Stockée
  dans PostgreSQL ; les prompts système sont des données, pas du code.
- **Modèles** : open source (Mistral, Qwen…) via Ollama local, ou propriétaires (OpenAI,
  Anthropic…) via clé API configurée en administration — clé **masquée** dans l'UI,
  chiffrée au repos, jamais renvoyée au client.
- **Conversations** : propriétaire = créateur (visible par lui seul) ; agent **immuable** après
  création de la conversation ; titre généré par l'IA à partir des 2 premiers échanges ;
  messages utilisateur à droite, agent à gauche, bulles selon la charte (§8.2 : agent =
  fond charbon, code SQL en jaune).
- **Streaming** : diffusion temps réel via Supabase Realtime.
- **Traçabilité sans fuite** : journaliser métadonnées (durée, modèle, coût en tokens) mais
  jamais les secrets ; les prompts des utilisateurs sont des données personnelles (RGPD) —
  pas de transmission à des tiers hormis le LLM configuré.

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
