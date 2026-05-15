# Next.js + Supabase Starter Template

[![Next.js](https://img.shields.io/badge/Next.js-16+-000000?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-3.0+-3ECF8E?logo=supabase)](https://supabase.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4+-06B6D4?logo=tailwindcss)](https://tailwindcss.com)
[![shadcn/ui](https://img.shields.io/badge/shadcn/ui-0.4+-000000?logo=github)](https://ui.shadcn.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Template de demarrage ultra-rapide pour creer des applications web full-stack avec Next.js et Supabase.**

Ce depot fournit une **base reproductible et prete a l'emploi** pour lancer de nouveaux projets web modernes. Il combine une stack full-stack prete a deployer avec les meilleures pratiques Supabase et Next.js.

---

## Pourquoi ce template ?

| Avantages | Description |
|--|--|
| :zap: Pret en 5 minutes | Clonez, configurez, codez |
| :dart: Deux modes possibles | Supabase Cloud OU auto-heberge avec Docker |
| :lock: Authentification incluse | Cookie-based auth avec @supabase/ssr |
| :art: UI moderne | Tailwind CSS + shadcn/ui |
| :package: Full-stack | PostgreSQL, Auth, Storage, Realtime |
| :rocket: Production ready | Deployable sur Vercel, Netlify, etc. |

---

## :file_folder: Structure du projet

```
sandbox/
├── apps/
│   ├── nextjs/                 # Votre application Next.js
│   │   ├── app/                # Pages et routes (App Router)
│   │   │   ├── auth/           # Pages d'authentification
│   │   │   ├── protected/      # Pages protegees (require auth)
│   │   │   ├── layout.tsx      # Layout principal
│   │   │   └── page.tsx        # Page d'accueil
│   │   ├── components/         # Composants React (shadcn/ui)
│   │   ├── lib/                # Configuration Supabase
│   │   │   ├── server.ts       # Client Supabase (server-side)
│   │   │   └── client.ts       # Client Supabase (client-side)
│   │   ├── proxy.ts            # Middleware pour Supabase
│   │   ├── .env.example        # Exemple de variables d'environnement
│   │   └── package.json        # Dependances
│   │
│   └── supabase/               # Configuration Supabase auto-heberge
│       ├── docker-compose.yml # Orchestration Docker
│       ├── .env.example        # Configuration par defaut
│       ├── utils/              # Scripts utilitaires
│       │   ├── generate-keys.sh      # Genere des cles securisees
│       │   └── add-new-auth-keys.sh   # Ajout des nouvelles cles d'auth
│       └── volumes/            # Donnees persistantes
└── docs/
    └── getting-started/        # Documentation locale
        ├── Self_Hosting_with_Docker.md
        └── Use_Supabase_with_Nextjs.md
```

---

## :rocket: Demarrage rapide

### Option 1: Supabase Cloud (Recommande pour commencer)

La maniere la plus simple pour demarrer.

```bash
# 1. Aller dans l'application Next.js
cd apps/nextjs/

# 2. Copier le fichier d'exemple
cp .env.example .env.local

# 3. Editer .env.local avec vos identifiants Supabase
```

Editez le fichier avec vos valeurs (disponibles dans Settings > API de votre projet Supabase) :
```env
NEXT_PUBLIC_SUPABASE_URL=https://votre-projet.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sbp_XXX_votre_cle_publique_XXX
```

```bash
# 4. Installer les dependances et demarrer
npm install
npm run dev
```

Votre application sera disponible sur **[http://localhost:3000](http://localhost:3000)**

---

### Option 2: Supabase Auto-heberge (Full local)

Pour un developpement **100% local** sans dependance externe.

```bash
# 1. Demarrer Supabase avec Docker
cd apps/supabase

# 2. Copier la configuration
cp .env.example .env

# 3. Generer des cles securisees (OBLIGATOIRE !)
sh utils/generate-keys.sh
sh utils/add-new-auth-keys.sh

# 4. Demarrer tous les services
docker compose pull
docker compose up -d
```

Attendez que tous les services soient `Up (healthy)` :
```bash
docker compose ps
```

```bash
# 5. Configurer l'application Next.js
cd ../nextjs/

# Recuperer l'URL et la cle publique depuis Studio (http://localhost:8000)
# Identifiants : DASHBOARD_USERNAME / DASHBOARD_PASSWORD (dans .env)

# Creer .env.local
echo "NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000" > .env.local
echo "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$(grep SUPABASE_PUBLISHABLE_KEY ../supabase/.env | cut -d'=' -f2)" >> .env.local

# 6. Demarrer l'application
npm install
npm run dev
```

Votre application Next.js communiquera avec votre instance Supabase locale !

---

## :clipboard: Prerequis

### Option 1 (Supabase Cloud)
- Node.js 18+ 
- npm, yarn ou pnpm
- Un [projet Supabase](https://database.new) (gratuit)

### Option 2 (Auto-heberge)
| Ressource | Minimum | Recommande |
|----------|---------|-------------|
| RAM | 4 GB | 8 GB+ |
| CPU | 2 coeurs | 4 coeurs+ |
| Disk | 50 GB SSD | 80 GB+ SSD |
| OS | Linux/macOS/Windows | Linux (recommande) |

- Docker et Docker Compose
- Git

---

## :toolbox: Fonctionnalites incluses

### Next.js 14
- :zap: **App Router** - Routing moderne avec React Server Components
- :lock: **Auth Cookie-based** - Gestion des sessions avec @supabase/ssr
- :art: **Tailwind CSS** - Styling utilitaire-first
- :jigsaw: **shadcn/ui** - Composants accessibles et personnalisables
- :package: **Server Actions** - Mutations cote serveur
- :globe_with_meridians: **Middleware** - Protection des routes
- :sparkles: **TypeScript** - Typage fort partout

### Supabase
- :card_file_box: **PostgreSQL** - Base de donnees relationnelle avec RLS
- :key: **Auth** - Authentification (email/password, OAuth, magic links)
- :file_folder: **Storage** - Stockage de fichiers S3-compatible
- :envelope: **Realtime** - Subscriptions temps reel via WebSockets
- :wrench: **PostgREST** - API REST auto-generee partir de PostgreSQL
- :bullseye: **Edge Functions** - Executer du code serverless

### Auto-hebergement (Docker)
- :whale: **Docker Compose** - Orchestration de tous les services
- :bar_chart: **Studio Dashboard** - Interface d'administration
- :closed_lock_with_key: **Configuration securisee** - Generation automatique des secrets
- :scroll: **Scripts utilitaires** - Maintenance et mise a jour

---

## :books: Documentation

Ce template suit les **documentations officielles** Supabase :

| Resource | Lien |
|----------|------|
| Self-Hosting with Docker | [supabase.com/docs/guides/self-hosting/docker](https://supabase.com/docs/guides/self-hosting/docker) |
| Next.js Quickstart | [supabase.com/docs/guides/getting-started/quickstarts/nextjs](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs) |
| Auth with Next.js | [supabase.com/docs/guides/auth/server-side/nextjs](https://supabase.com/docs/guides/auth/server-side/nextjs) |

**Copies locales disponibles** dans `docs/getting-started/` :
- `Self_Hosting_with_Docker.md`
- `Use_Supabase_with_Nextjs.md`

---

## :dart: Cas d'utilisation

### 1. Creer une nouvelle application

```bash
# Cloner ce template pour un nouveau projet
git clone <ce-depot> mon-nouveau-projet
cd mon-nouveau-projet

# Supprimer l'historique git pour repartir de zero
rm -rf .git

# Initialiser un nouveau depot git
git init
git add .
git commit -m "Initial commit: Next.js + Supabase starter"

# Suivre les etapes de demarrage ci-dessus
```

### 2. Developper localement avec Supabase Cloud

La configuration par defaut fonctionne parfaitement avec **Supabase Cloud** :
1. Creez un projet sur [supabase.com/database/new](https://database.new)
2. Recuperez l'URL et la cle dans `Settings > API`
3. Configurez `.env.local`
4. Codez !

### 3. Developper 100% localement

Pour un environnement de developpement **isole** :
1. Demarrez Supabase avec `docker compose up -d`
2. Configurez Next.js pour pointer vers `http://localhost:8000`
3. Tout fonctionne en local sans dependance externe !

### 4. Ajouter des fonctionnalites

Exemples :
- **Nouveaux providers OAuth** (Google, GitHub, etc.) dans `apps/supabase/docker-compose.yml`
- **Edge Functions** dans `apps/supabase/volumes/functions/`
- **Nouvelles tables** via SQL Editor ou migrations
- **Row Level Security** pour protege vos donnees

---

## :gear: Configuration

### Variables d'environnement (Next.js)

| Variable | Description | Exemple | Obligatoire |
|----------|-------------|---------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL de votre projet Supabase | `https://xxx.supabase.co` | :white_check_mark: |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Cle publique (client-side) | `sbp_XXX` | :white_check_mark: |

### Variables d'environnement (Supabase - Auto-heberge)

Fichier : `apps/supabase/.env`

| Variable | Description | Exemple | Obligatoire |
|----------|-------------|---------|-------------|
| `SUPABASE_PUBLIC_URL` | URL base pour Supabase | `http://localhost:8000` | :white_check_mark: |
| `API_EXTERNAL_URL` | URL pour les callbacks Auth | `http://localhost:8000` | :white_check_mark: |
| `SITE_URL` | URL de redirection par defaut | `http://localhost:3000` | :white_check_mark: |
| `POSTGRES_PASSWORD` | Mot de passe PostgreSQL | `(genere automatiquement)` | :white_check_mark: |
| `SUPABASE_PUBLISHABLE_KEY` | Cle publique | `(generee automatiquement)` | :white_check_mark: |
| `SUPABASE_SECRET_KEY` | Cle secrte (server-side) | `(generee automatiquement)` | :white_check_mark: |
| `DASHBOARD_PASSWORD` | Mot de passe Studio | `mon-mot-de-passe` | :white_check_mark: |
| `DASHBOARD_USERNAME` | Nom d'utilisateur Studio | `admin` | :x: |

> :warning: **IMPORTANT** : Executez `sh utils/generate-keys.sh` et `sh utils/add-new-auth-keys.sh` avant de demarrer !

---

## :rocket: Deployment

### Application Next.js

#### Vercel (Recommande)

```bash
# Dans apps/nextjs/
vercel
```

Vercel detectera automatiquement l'integration Supabase.

Pour forcer l'installation :
```bash
vercel --integration supabase
```

#### Autres plateformes
- **Netlify** - Serverless Functions
- **AWS Amplify** - Support Next.js
- **Railway** - Deployment facile
- **Render** - Applications full-stack

### Supabase Auto-heberge (Production)

1. **Choisir un VPS**
   - DigitalOcean Droplet
   - AWS EC2 (t3.medium minimum)
   - Hetzner Cloud
   - OVH

2. **Installer les prequis**
   ```bash
   # Ubuntu/Debian
   sudo apt update
   sudo apt install -y docker.io docker-compose git
   ```

3. **Deployer Supabase**
   ```bash
   git clone <ce-depot>
   cd sandbox/apps/supabase
   
   sh utils/generate-keys.sh
   sh utils/add-new-auth-keys.sh
   
   # Configurer l'URL publique dans .env
   # SUPABASE_PUBLIC_URL=https://votre-domaine.com
   
   docker compose pull
   docker compose up -d
   ```

4. **Configurer HTTPS**
   - **Caddy** (recommande) : `docker-compose.caddy.yml`
   - **Nginx** : `docker-compose.nginx.yml`
   - **Envoy** : `docker-compose.envoy.yml`

5. **Configurer les backups**
   ```bash
   # Backup de la base de donnees
   docker exec supabase-db pg_dump -U postgres -d postgres > backup.sql
   
   # Backup des volumes
   docker run --rm --volumes-from supabase-db -v $(pwd):/backup alpine \
     tar cvf /backup/db-backup.tar /var/lib/postgresql/data
   ```

---

## :bulb: Bonnes pratiques

### Developpement
- :white_check_mark: Utilisez des **branches** pour chaque fonctionnalite
- :white_check_mark: Configurez **ESLint** (`npm run lint`)
- :white_check_mark: Utilisez **TypeScript** partout
- :white_check_mark: Activez **RLS** sur toutes les tables

### Production
- :white_check_mark: Utilisez un **gestionnaire de secrets** (Doppler, Infisical, AWS Secrets Manager)
- :white_check_mark: **HTTPS obligatoire** pour OAuth
- :white_check_mark: Configurez des **backups automatiques**
- :white_check_mark: **Monitoring** avec Vector + Logflare
- :white_check_mark: Suivez le [CHANGELOG](apps/supabase/CHANGELOG.md)

### Securite
- :x: Ne commitez **JAMAIS** `.env` ou `.env.local`
- :x: Ne partagez **JAMAIS** `SUPABASE_SECRET_KEY`
- :x: Utilisez **toujours** HTTPS en production
- :x: Activez **toujours** RLS sur les tables sensibles

---

## :telephone: Support et Ressources

### Documentation
- [Supabase Docs](https://supabase.com/docs)
- [Next.js Docs](https://nextjs.org/docs)
- [shadcn/ui Docs](https://ui.shadcn.com/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)

### Communaute
- [Supabase Discord](https://discord.supabase.com)
- [Supabase GitHub](https://github.com/supabase/supabase)
- [Next.js Discord](https://nextjs.org/discord)
- [Stack Overflow](https://stackoverflow.com/questions/tagged/supabase)

### Tutoriels
- [Cookie-based Auth with Next.js 13+](https://youtube.com/playlist?list=PL5S4mPUpp4OtMhpnp93EFSo42iQ40XjbF)
- [Supabase Examples](https://github.com/supabase/supabase/tree/master/examples)

---

## :handshake: Contribution

1. Forker le depot
2. Cree une branche (`git checkout -b feature/amazing-feature`)
3. Commitez vos changements (`git commit -m 'Add amazing feature'`)
4. Poussez vers la branche (`git push origin feature/amazing-feature`)
5. Ouvrez une Pull Request

---

## :scroll: License

**MIT License** - libre d'utiliser, modifier et distribuer.

Voir [LICENSE](LICENSE) pour plus de details.

---

## :memo: Changelog

| Date | Version | Description |
|------|---------|-------------|
| 2025-05-XX | 1.0.0 | Version initiale - Next.js 14 + Supabase Starter |

---

<p align="center">
  Made with :heart: using Next.js and Supabase
</p>
