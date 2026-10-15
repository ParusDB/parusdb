# ParusDB

> La plateforme Data Analytique IAgentique Open Source — « Vos données, enfin parlantes. »

[![Licence](https://img.shields.io/badge/licence-ELv2-1A1A1A)](#licence)
[![Statut](https://img.shields.io/badge/statut-en%20d%C3%A9veloppement-FFD700)](#état-du-projet)
[![Langue](https://img.shields.io/badge/langue-Fran%C3%A7ais-6B8E23)](https://parusdb.com/)

**ParusDB** unifie **ELT**, **Data Lakehouse** et **agents IA** dans une plateforme open
source et souveraine. Déployez-la vous-même, contribuez, ou utilisez-la gratuitement.

Assembler une Modern Data Stack, c'est long, cher, fragile. ParusDB supprime ces barrières :
une plateforme **unifiée** où chaque équipe interroge ses données **en langage naturel** via des
agents IA, où le déploiement se fait **en minutes, pas en mois**, et où vos données ne quittent
**jamais** votre infrastructure.

- **100 % Open Source** sous licence **ELv2** : forkez, contribuez, déployez où vous voulez.
- **Auto-hébergement** par défaut : votre serveur, votre cloud, votre local — aucun vendor
  lock-in.
- **Souveraineté totale** : chiffrement au repos et en transit, conforme RGPD, BYO tout
  (S3, LLM, infrastructure).
- **Gratuite** : plus de forfaits, plus de limites. Juste du code, des conteneurs, et la
  liberté de déployer où vous voulez.

## Une plateforme, cinq briques

| Brique | Ce que ça fait |
|---|---|
| **Chat IA** | Interrogation en langage naturel : l'agent choisit le catalogue, écrit le SQL, restitue des chiffres, tableaux et graphiques sourcés — visualisés et exportables. |
| **Agents IA personnalisables** | Pré-instructions, sources associées, LLM au choix par agent : modèles open source exécutés en local (Mistral, Qwen…) ou propriétaires via clé API. Un agent par usage : ventes, support, finance. |
| **Data Lakehouse intégré** | Object Storage S3 (RustFS) + catalogue Iceberg (Apache Polaris) + moteur SQL (Trino). La puissance d'une stack moderne, sans l'assembler. |
| **40+ connecteurs ELT** | Snowflake, PostgreSQL, Salesforce, HubSpot, Notion, Stripe, Shopify, S3… Ingestion incrémentale, ordonnancement CRON, glisser-déposer. Extensibles par la communauté. |
| **RBAC & gouvernance** | Profils métiers, techniques, admin. Permissions granulaires par catalogue, rôles multiples, rôle actif au switch. |

Brique transversale : le tout est **open source, auditable et transparent** (licence ELv2).

## Stack technique

| Couche | Technologie | Rôle |
|---|---|---|
| **Frontend** | Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui | Interface réactive, typage de bout en bout |
| **Backend** | Supabase (PostgreSQL), self-hosted | Auth, utilisateurs, RBAC, données transactionnelles |
| **Data Lakehouse** | RustFS S3 (Supabase) · Apache Polaris · Trino | Stockage objet, catalogue Iceberg, requêtage SQL fédéré |
| **Chat IA** | Ollama · mcp-trino (Model Context Protocol) | LLM en local, interrogation Trino via MCP |
| **ELT** | dlt (data load tool) | Pipelines d'ingestion génériques et variabilisés |
| **Temps réel** | Supabase Realtime | Streaming des conversations chat |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Sources de données                      │
│     PostgreSQL · Salesforce · Stripe · S3 · fichiers · …     │
└──────────────────────────────┬───────────────────────────────┘
                               │ ELT — dlt (incrémental, CRON)
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                        Data Lakehouse                        │
│    RustFS S3 (stockage objet) · Apache Polaris (catalogue    │
│             Iceberg) · Trino (moteur SQL fédéré)             │
└──────────────▲──────────────────────────────▲────────────────┘
               │ SQL                          │ SQL via mcp-trino
               │                              │
┌──────────────┴─────────────┐    ┌───────────┴────────────────┐
│     Interface Next.js      │    │         Agents IA          │
│  éditeur SQL · chat        │◄──►│  Ollama (local) ou LLM     │
│  connecteurs · admin       │    │  propriétaires via clé API │
└─────────┬─────────────────┘    └───────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────┐
│             Supabase — PostgreSQL (self-hosted)              │
│         Auth · RBAC · rôles actifs · config agents,          │
│                pipelines, serveurs (S3, LLM)                 │
└──────────────────────────────────────────────────────────────┘
```

## Démarrage rapide

**Prérequis** : Git, Node.js LTS + npm, Docker avec le plugin Compose.

### 1. Stack Supabase (self-hosted)

```bash
cd apps/supabase
cp .env.example .env
sh utils/generate-keys.sh --update-env        # mots de passe + clés API
sh utils/add-new-auth-keys.sh --update-env    # clés publishable/secret
sh run.sh start                              # docker compose up -d --wait
```

Les URLs et ports des services (Studio, API, Auth…) sont définis dans
`apps/supabase/.env`. Guide complet : [`apps/supabase/README.md`](apps/supabase/README.md)
et la [documentation self-hosting Supabase](https://supabase.com/docs/guides/self-hosting/docker).

### 2. Frontend Next.js

```bash
cd apps/nextjs
npm install
cp .env.example .env.local
# Renseigner NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npm run dev   # http://localhost:3000
```

La clé publishable est générée à l'étape précédente (`SUPABASE_PUBLISHABLE_KEY` dans
`apps/supabase/.env`).

> **Note** : le parcours produit complet (« clonez, `docker compose up -d`, instance prête
> en 5 minutes ») sera livré avec la première release. En attendant, le dépôt s'adresse aux
> contributeurs : chaque brique se développe ici.

## État du projet

Le projet est en **développement actif**. Le socle Next.js + Supabase (authentification
complète, clients SSR) est fonctionnel ; les briques produit arrivent dans cet ordre :

- [x] **Socle** — Next.js (App Router) + Supabase self-hosted, auth fonctionnelle
- [ ] **Data Lakehouse** — catalogues, schémas, explorateur, éditeur SQL
- [ ] **Chat IA** — agents, Ollama, mcp-trino, conversations, streaming
- [ ] **Interface frontend** — menus, RBAC, administration
- [ ] **Flux ELT** — dlt, 40+ connecteurs, pipelines, CRON
- [ ] **Release open source** — déploiement `docker compose up -d` prêt à l'emploi

## Structure du dépôt

```
parusdb/
├── AGENTS.md             # Règles de développement pour agents IA et contributeurs
├── README.md             # Ce fichier
├── docs/functional/      # Fiche produit, spécifications fonctionnelles, charte graphique
├── apps/nextjs/          # Application Next.js 16 (App Router) — frontend + BFF
└── apps/supabase/        # Stack Supabase self-hosted (Docker Compose)
```

## Documentation

- [Fiche produit](docs/functional/product_page.md) — pitch, positionnement, promesses
- [Spécifications fonctionnelles](docs/functional/functional_specifications.md) — menus,
  fonctionnalités, modèle de données, RBAC, parcours
- [Charte graphique « Mésange Charbonnière »](docs/functional/brand_guidelines.md) — tokens,
  typographie, composants, conformité
- [`apps/nextjs/README.md`](apps/nextjs/README.md) · [`apps/supabase/README.md`](apps/supabase/README.md)
  · [`apps/supabase/CONFIG.md`](apps/supabase/CONFIG.md) — guides techniques des apps

## Contribuer

Tous les contributeurs sont bienvenus : forkez le dépôt, créez une branche, soumettez une PR.

1. Forkez puis clonez le dépôt.
2. Créez votre branche : `feat/<brique>-<sujet>` (ex. `feat/lakehouse-explorateur`).
3. Développez en suivant [`AGENTS.md`](AGENTS.md) — conventions de code, charte graphique,
   definition of done. Les agents de développement IA doivent le lire en premier.
4. Ouvrez une Pull Request décrivant le quoi et le pourquoi.

Questions et discussions : [GitHub Discussions](https://github.com/ParusDB/parusdb/discussions).
Bugs : [Issues](https://github.com/ParusDB/parusdb/issues).

## Licence

Code source publié sous licence **ELv2** (Elastic License 2.0) : utilisation, modification
et déploiement libres, sans redevance — sous les restrictions usuelles de la ELv2 (pas
d'exploitation du logiciel en offre managée, pas de contournement des protections de licence).
Référence : <https://elastic.co/licensing/elastic-license>.

Une offre managée officielle, **ParusDB Cloud**, est proposée pour se concentrer sur les
données sans gérer l'infrastructure — avec migration vers le self-hosting possible à tout
moment. Contact : [parusdb.com](https://parusdb.com/).

## Liens

- **Site** : <https://parusdb.com/>
- **GitHub** : <https://github.com/ParusDB/parusdb>
- **Documentation, guides, changelog** : en construction
