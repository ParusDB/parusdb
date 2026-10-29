# Spécifications Fonctionnelles - ParusDB

---

## 📋 Table des Matières

1. Introduction
2. Architecture Fonctionnelle
3. Menus et Fonctionnalités
4. Gestion des Données
5. Connecteurs ELT
6. Modèle de Données et Relations
7. Rôles et Permissions
8. Parcours Utilisateur

---

## 🎯 Introduction

**ParusDB** est une **plateforme data analytique tout-en-un**, conçue selon une approche **"IA Agentique First"** et **souveraine**. Elle intègre nativement :

- ✅ **ELT** (Extract, Load, Transform) pour l'ingestion de données
- ✅ **Data Lakehouse** pour le stockage et l'analyse à grande échelle
- ✅ **Chat IA** avec des agents personnalisables

**Public cible** :

- **Équipes métiers** (marketing, ventes, finance...) : accès simplifié aux insights
- **Équipes techniques** (data engineers, CTO, DPO) : contrôle total sur l'infrastructure

**Accès** : Application web auto-hébergée, accessible via navigateur après authentification.

---

## 🏗️ Architecture Fonctionnelle

### Stack Technique Complète

| Couche | Technologie | Rôle |
| --- | --- | --- |
| **Frontend** | Next.js (App Router) | Interface utilisateur réactive |
| **Frontend - Langage** | TypeScript | Typage statique de bout en bout |
| **Frontend - Style** | Tailwind CSS | Styles utilitaires et gestion des thèmes |
| **Frontend - Composants** | shadcn/ui | Bibliothèque de composants accessibles et réutilisables |
| **Backend** | Supabase (PostgreSQL) | Gestion des utilisateurs, données transactionnelles |
| **Data Lakehouse** | Apache Polaris + Trino + RustFS S3 (de Supabase) | Stockage et requêtage SQL fédéré |
| **Chat IA** | Ollama + mcp-trino | Exécution locale de LLM et requêtage Trino via MCP |
| **ELT** | dlt (data load tool) | Pipelines d'ingestion de données |

### Composants Clés

| Composant | Technologie | Rôle |
| --- | --- | --- |
| **Frontend** | Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui | Interface utilisateur réactive |
| **Backend** | Supabase (PostgreSQL) | Gestion des utilisateurs, données transactionnelles |
| **Data Lakehouse** | Apache Polaris + Trino + RustFS S3 (Supabase) | Stockage et requêtage SQL fédéré |
| **Chat IA** | Ollama + mcp-trino | Exécution locale de LLM et intégration avec Trino via MCP |
| **ELT** | dlt (data load tool) | Pipelines d'ingestion de données |

---

## 📑 Menus et Fonctionnalités

### 🔹 Menu Principal

L'interface propose une **barre de navigation latérale gauche** avec les sections suivantes (par ordre) :

```
┌─────────────────────────────────────┐
│  🏠 ParusDB                         │
├─────────────────────────────────────┤
│ 💬 Chat                             │
│   ├── Nouveau Chat                  │
│   └── [Conversations accessibles]   │
│                                     │
│ 🤖 Agents IA                        │
│   ├── Nouvel Agent IA               │
│   └── [Agents accessibles]          │
│                                     │
│ 🗃️ Data Lakehouse                   │
│                                     │
│ 🔌 Connecteurs                      │
│                                     │
│ ⚙️ Administration                   │
│   (rôle admin uniquement)           │
│   ├── Informations                  │
│   ├── Utilisateurs                  │
│   │   ├── Humains                   │
│   │   └── Applicatifs               │
│   ├── Rôles                         │
│   └── Fournisseurs LLM              │
│                                     │
└─────────────────────────────────────┘
```

Tous les menus fonctionnels sont visibles par les comptes authentifiés : le
**contenu** de chaque section dépend du rôle actif (RBAC à grants, §Rôles
et Permissions).

**Logo** : le logo officiel occupe le haut du menu latéral (plein cadre) et sert de
bouton « Accueil » (retour au Chat).

**Items Conversations et Agents IA** : chaque élément propose un menu « trois points »
(visible au survol) avec :
- ✏️ Renommer
- 🗑️ Supprimer (confirmation ; ressaisie du nom pour un agent)

**Zone utilisateur** (en bas à gauche) :

- Affichage du user connecté (prénom, nom, email)
- Sélecteur de thème : Dark Mode / Light Mode / System Mode
- Sélecteur de **rôle actif** (pour les utilisateurs multi-rôles)

---

## 🗃️ Data Lakehouse

**Accès** : Menu "Data Lakehouse"

**Architecture technique** :

- **Stockage** : RustFS S3 (Supabase) - Service de fichiers type S3
- **Catalogue** : Apache Polaris (API REST Apache Iceberg) - Gestion des métadonnées
- **Moteur SQL** : Trino - Requêtage fédéré SQL

**Fonctionnalités** :

- ✅ Création de **multiples catalogues** (exemple vision technique : prod, dev, stg)
- ✅ **Redémarrage Trino automatique** après création d'un catalogue — différé tant qu'une requête SQL est en cours, annoncé dans l'interface (« Redémarrage en cours… ») : aucune commande en terminal n'est nécessaire
- ✅ Organisation en **schémas** (customers, products, etc.)
- ✅ Association des catalogues/schémas à un ou plusieurs **agents LLM**
- ✅ **Interface SQL** : Éditeur de requêtes avec coloration syntaxique, onglets, affichage des résultats
- ✅ **Explorateur de schémas** : Arbre des schémas → tables/vues → colonnes
- ✅ **Métriques globales** : Espace disque utilisé (Go), nombre de fichiers, etc.

**Catalogues d'installation** : une installation fraîche expose deux catalogues,
créés automatiquement au démarrage :

| Catalogue | Rôle |
|---|---|
| `parusdb` | Catalogue **système** de la plateforme — **catalogue par défaut, premier créé, non supprimable**. Usage libre (administration de ParusDB, données internes), l'équivalent de la base `snowflake` de Snowflake |
| `dev` | Catalogue d'**environnement** initial — premier catalogue de données ; les pipelines ELT visent librement n'importe quel catalogue du lakehouse |

Chaque catalogue est requêtable dans Trino sous **son propre nom** (jamais un
nom technique générique) : `SELECT * FROM dev.clients`, `SELECT * FROM
parusdb.<schéma>.<table>`.

**Cas particulier** : Si un catalogue est vide, proposition automatique de créer un premier connecteur (redirection vers le menu "Connecteurs").

---

## 🔌 Connecteurs ELT

**Accès** : Menu "Connecteurs"

**Technologie** : Basé sur dlt (data load tool) - Pipelines génériques variabilisés.

**Fonctionnalités** :

- ✅ Liste des pipelines avec statut (🟢 actif, 🔴 inactif, ⚠️ erreur)
- ✅ Date de création et dernière exécution
- ✅ Ordonnancement (CRON)
- ✅ Actions : Modifier (✏️), Supprimer (🗑️), Lancer (▶️), Désactiver (⏸️)
- ✅ **Destination unique** : Toujours vers le Data Lakehouse (catalogue spécifié)

---

### 📚 Sources Disponibles

### Core Sources

| Catégorie | Sources |
| --- | --- |
| **REST APIs** | REST APIs |
| **SQL Databases** (30+) | PostgreSQL, MySQL, SQLite, Oracle, Microsoft SQL Server, MariaDB, IBM DB2, Informix, Google BigQuery, Snowflake, Redshift, Apache Hive, Presto, SAP Hana, CockroachDB, Firebird, Teradata Vantage |
| **Object Store & Filesystem** | AWS S3, Google Cloud Storage, Google Drive, Azure Blob Storage, remote filesystem (SFTP), local filesystem, Public CDN |

### Verified Sources

| Catégorie | Sources |
| --- | --- |
| **CRM/ERP** | Salesforce, HubSpot, Pipedrive, Zendesk, Freshdesk |
| **Marketing** | Google Ads, Facebook Ads, Google Analytics, Matomo |
| **Collaboration** | Slack, Notion, GitHub, Jira, Asana, Workable |
| **E-commerce** | Shopify, Stripe |
| **Bases de données** | MongoDB, PostgreSQL Replication |
| **Autres** | Airtable, Amazon Kinesis, Apache Kafka, Chess, Inbox, Mux, Personio, Scrapy, Strapi |

**Liste complète** : dlt Verified Sources

---

### 🎯 Processus de Création d'un Pipeline

1. **Sélection de la source**
- Interface avec icônes des sources disponibles
    - Exemples : 🏔️ Snowflake, 🐘 PostgreSQL, 📊 Notion, 🐞 Jira...
1. **Configuration des credentials**
- Exemple pour une base SQL (PostgreSQL) :
- Database
- Username
- Host
- Port
    - Bouton **"Test connexion"** → Validation de l'accès et récupération des métadonnées
    - Bouton **"Suivant"** (désactivé tant que la connexion n'est pas validée)
1. **Sélection des données et paramètres**
- Sélection des **tables/vues** à charger
    - **Mode d'insertion** :
        - 🔄 **Incrémental** :
            - Crée la table si elle n'existe pas
            - Ne charge que les nouvelles données depuis la dernière exécution
            - Documentation dlt
        - 🗑️ **Toutes les données** : Recréation complète de la table à chaque exécution
    - **Ordonnancement** : Basé sur CRON (ex : `0 0 * * *` pour quotidien à minuit)
1. **Finalisation**
- Bouton **"Enregistrer"** : Sauvegarde + lancement immédiat du pipeline
    - Bouton **"Retour"** : Annulation

---

## 🔗 Modèle de Données et Relations

### Entités Principales

```
┌─────────────────────┐       ┌─────────────────────┐
│     Data Lakehouse   │       │       Agent IA       │
│─────────────────────│       │─────────────────────│
│ - Bucket S3          │       │ - Nom                │
│   └── Catalogue(s)   │◄──────┤ - Modèle LLM         │
│       Apache Polaris │   1:N │ - Prompt système     │
│       └── Schéma(s)  │       │ - Sources associés   │
│           Trino      │       │   (catalogues,       │
└─────────────────────┘       │    schémas, réper-   │
                              │    toires de fichiers)│
                              │ - Propriétaire       │
                              │   (rôle utilisateur) │
                              └──────────┬───────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │        Chat          │
                              │─────────────────────│
                              │ - Agent associé      │
                              │ - Messages           │
                              │ - Propriétaire       │
                              │   (utilisateur)      │
                              └─────────────────────┘
```

### Définitions

**Data Lakehouse** :

- 1 **Bucket S3** (RustFS)
    - N **Catalogues** Apache Polaris
        - N **Schémas** (namespaces)
            - Connecté à **Trino** (moteur SQL)

**Agent IA** :

- **1 Modèle LLM** obligatoire :
    - **Open Source** : Mistral Medium 3.5, Qwen 3.5, etc. (téléchargeable via Ollama)
    - **Propriétaire** : Modèles payants (GPT 5.3, Sonnet 4.5) avec clé API (configurée en administration, §Fournisseurs LLM)
    - La **source du modèle** (Ollama local ou fournisseur par clé API) est choisie dans le formulaire de l'agent
- **1..N Sources** :
    - Catalogues Data Lakehouse
    - Schémas
    - Répertoires de fichiers
- **Propriétaire** : Rôle actif de l'utilisateur au moment de la création

**Chat** :

- **1 Agent IA** associé (obligatoire, non modifiable après création)
- **Propriétaire** : Utilisateur qui a initié la conversation (seul lui peut y accéder)
- **Messages** : Historique des échanges (utilisateur ←→ agent)

---

## 👤 Rôles et Permissions

> Modèle RBAC à **grants**, calqué sur Apache Polaris
> (`docs/functional/rbac_refonte.md` en fait la spécification de référence
> détaillée pour cette brique).

### Concepts

| Concept | Description |
| --- | --- |
| **Rôle** | Groupement de comptes (ex. `data_engineer`, `sales`), créé par un administrateur |
| **Rôle actif** | Un compte peut cumuler plusieurs rôles et **sélectionne son rôle actif** ; tous les accès aux objets s'évaluent sur le rôle actif |
| **Ressource** | Catalogue, agent IA ou pipeline — les objets de la plateforme |
| **Privilèges** | `Lecture` ⊂ `Écriture` ⊂ `Gestion` (hiérarchiques) |
| **Propriété** | Le rôle actif qui **crée** un objet en devient propriétaire : tous les comptes portant ce rôle le voient avec tous les droits |
| **Grant** | Droit distribué par l'administrateur à un rôle sur une ressource (cross-rôle) |

**Rôles système** :

| Rôle | Description |
| --- | --- |
| **Administrateur** (`admin`) | Hérite de tout : accès complet implicite à toutes les ressources, quelle que soit la table des grants |
| **Public** (`public`) | Attribué automatiquement aux nouveaux comptes : **aucun accès aux objets**. Un administrateur leur attribue des rôles via Utilisateurs |

**Fonctionnalités RBAC** :

- ✅ Création de **rôles personnalisés** et distribution des **droits par objet**
  (matrice Catalogues / Agents IA / Pipelines × Lecture / Écriture / Gestion)
- ✅ Association de **multiples rôles** à un compte et choix du **rôle actif**
- ✅ Menus visibles par tous les comptes authentifiés : le **contenu** dépend du
  rôle actif (listes vides si aucun objet accessible)
- ✅ Section **Administration** visible et accessible uniquement aux comptes
  portant le rôle `admin`

**Chats** : les conversations appartiennent au **compte**, pas au rôle. Le
propriétaire peut **partager** une conversation en **lecture seule** aux
comptes partageant l'un de ses rôles (bouton « Partager » à côté du crayon de
renommage), et révoquer l'accès à tout moment.

**Comptes applicatifs** : des comptes service (dbt, Power BI, Airbyte, Spark…)
connectés au catalogue Iceberg Polaris — voir §Administration / Utilisateurs
et §Administration / Informations.

---

### Onboarding du Premier Démarrage

**Déclencheur** : la plateforme ne compte **aucun utilisateur** (premier
lancement après installation).

**Parcours** :

1. Toute visite des pages « Connexion » ou « Créer un compte » redirige vers
   l'écran d'**onboarding** (« moment fort » de la charte : charbon, grille,
   halo jaune).
2. L'écran annonce : « Vous êtes le premier utilisateur de cette installation :
   votre compte recevra le rôle **Administrateur**. »
3. Saisie : prénom, nom, email, mot de passe (8 caractères minimum) et
   confirmation.
4. **Aucune confirmation par email** : le compte est confirmé immédiatement,
   le rôle Administrateur est attribué automatiquement et la session s'ouvre
   directement.
5. Dès qu'un compte existe, l'écran disparaît définitivement : les visites
   suivantes retombent sur la page de connexion classique, et la création de
   compte passe par le parcours standard avec lien de confirmation.

**Garantie** : l'attribution du rôle Administrateur n'est possible **que** tant
qu'aucun compte n'existe — la condition est revérifiée côté serveur à la
soumission, jamais sur la seule décision de la page.

---

## 👥 Parcours Utilisateur

### Vue d'Ensemble

```
┌─────────────────────────────────────────────────────────────────┐
│  [Logo ParusDB]  ParusDB                    [👤 User | ☀️ | 🎭 Rôle] │
├─────────────────┬─────────────────────────────────────────────────┤
│                 │                                                     │
│  📋 MENU         │         CONTENU PRINCIPAL                          │
│  ┌─────────────┐ │                                                     │
│  │ 💬 Chat      │ │  [Contenu dynamique selon le menu sélectionné]     │
│  │   ├─ >      │ │                                                     │
│  │ 🤖 Agents IA │ │                                                     │
│  │   ├─ >      │ │                                                     │
│  │ 🗃️ Data Lak.  │ │                                                     │
│  │ 🔌 Connect.  │ │                                                     │
│  │             │ │                                                     │
│  │ ⚙️ Admin    │ │                                                     │
│  │   ├─ >      │ │                                                     │
│  │             │ │                                                     │
│  └─────────────┘ │                                                     │
│                 │                                                     │
└─────────────────┴─────────────────────────────────────────────────────┘
```

---

### Détails par Menu

### 💬 Chat

**Liste des conversations** :

- Affichage sous forme de liste
- **Noms générés par IA** : Résumé automatique à partir des 2 premiers échanges
- **Recherche** : Zone de texte en haut pour filtrer par nom
- **Actions par conversation** :
    - ✏️ Renommer
    - 🗑️ Supprimer (suppression définitive)
- **Nouveau Chat** : Bouton dédié (équivalent au sous-menu)

**Interface de conversation** :

- **État initial** (conversation vierge) :
    - Message d'accueil « Posez votre première question à [agent] » (sans logo)
    - Zone de texte en dessous pour :
        - Saisir le message
        - Sélectionner l'agent
        - Bouton "Envoyer"
- **Après premier message** :
    - Message d'accueil disparaît
    - Zone de texte descend
    - **Affichage classique** :
        - Messages utilisateur → **à droite**
        - Messages agent → **à gauche**, rendus en **markdown** (titres, listes, tableaux, code avec coloration syntaxique)

**Règles** :

- ❌ **Impossible de changer d'agent** une fois la conversation lancée
- 🔒 **Visibilité** : Seul le propriétaire (créateur) peut voir la conversation

---

### 🤖 Agents IA

**Liste des agents** :

- Affichage en **mode cartes**
- Chaque carte affiche :
    - Nom de l'agent
    - Description
    - Rôle propriétaire

**Création/Modification** :

- **Nom** : Zone de texte
- **Source du modèle** : Liste de sélection (sources disponibles : Ollama local, fournisseurs par clé API — cf. §Fournisseurs LLM)
- **Modèle** : Liste de sélection (modèles découverts pour la source choisie)
- **Description** : Zone de texte
- **Prompt système** : Zone de texte pour les instructions
- **Sources de connaissances** : Liste des bases disponibles (filtrée selon les droits du rôle actif)
    - Sélection multiple possible
- **Actions** :
    - 💾 **Enregistrer**
    - ❌ **Annuler**

---

### 🗃️ Data Lakehouse

**Liste des catalogues** :

- Affichage en liste/cartes
- **Métriques globales** :
    - Espace total utilisé (Go)
    - Nombre de fichiers
    - Nombre de tables

**Actions** :

- ✅ **Créer un catalogue** : Nom + description
- 🗑️ **Supprimer un catalogue** :
    - Confirmation admin
    - Warning : action irréversible
    - Validation par resaisie du nom du catalogue

**Interface d'un catalogue** :

- **Éditeur SQL** :
    - Zone de texte avec coloration syntaxique
    - Numérotation des lignes
    - Onglets pour plusieurs requêtes
    - Bouton d'exécution
    - Affichage des résultats au-dessus
- **Explorateur** (côté gauche) :
    - Arbre des schémas
    - Tables/Vues (développables)
    - Colonnes (affichées au survol/développement)

---

### 🔌 Connecteurs

**Liste des pipelines** :

- Affichage en tableau avec colonnes :
    - Nom
    - Source
    - Destination (catalogue)
    - Statut (🟢/🔴/⚠️)
    - Date création
    - Dernière exécution
    - Ordonnancement (CRON)

**Actions par pipeline** :

- ✏️ **Modifier** : Édition de la configuration
- 🗑️ **Supprimer** : Suppression définitive
- ▶️ **Lancer** : Exécution manuelle immédiate
- ⏸️ **Désactiver** : Suspension de l'ordonnancement

**Création** : Voir Processus de Création d'un Pipeline

---

### ⚙️ Administration

Visible et accessible uniquement aux comptes portant le rôle `admin`.

### Informations

**Objectif** : rendre le lakehouse consommable par des outils data externes
(dbt, Power BI, Airbyte, Spark, Flink, pyiceberg, clients JDBC/ODBC…), avec
les credentials d'un **compte applicatif** — jamais le compte root.

**Contenu** :

- Avertissement : connexions en HTTP, Trino sans authentification — usage
  réservé au réseau privé
- Sélecteurs : **compte applicatif** × **catalogue** (limité aux catalogues
  accessibles au rôle du compte)
- **Adresses de la plateforme** : Trino (hôte/port), Polaris (API Iceberg
  REST, jetons OAuth2), S3 (endpoint path-style, bucket, région) ; clés S3
  masquées, révélation ponctuelle
- **Sections par outil** : snippets copiables préremplis (profiles.yml dbt,
  URL JDBC, fiche Power BI/ODBC Starburst, configuration Spark, `CREATE
  CATALOG` Flink, pyiceberg, champs de la destination Airbyte « S3 Data
  Lake »)
- Le **client secret** n'est jamais stocké ni réaffiché : il apparaît une
  seule fois, à la création ou à la réinitialisation du compte applicatif

### Utilisateurs

**Deux onglets : Humains / Applicatifs.**

**Humains — tableau des utilisateurs** :

| Champ | Type | Description |
| --- | --- | --- |
| Prénom | Texte | Prénom de l'utilisateur |
| Nom | Texte | Nom de famille |
| Email | Email | Identifiant de connexion |
| Téléphone | Texte | Numéro de contact |
| Rôles | Tags | Rôles attribués (multiples) |
| Statut | Badge | Actif / Désactivé |
| Actions | Icônes | Désactiver, Modifier, Supprimer |

**Actions** :

- ➕ **Ajouter** : Création d'un nouvel utilisateur (rôle `public` par défaut,
  ajusté par l'administrateur)

**Applicatifs — comptes service pour les outils data** :

| Champ | Type | Description |
| --- | --- | --- |
| Nom | Texte | ex. `airbyte-prod` |
| Note d'usage | Texte | Rappel de l'outil concerné |
| Rôle | Sélecteur | Droits répliqués en grants Polaris réels |
| Client ID | Texte | Identifiant public du principal Polaris |
| Dernière rotation | Date | Dernière réinitialisation des credentials |

**Actions** :

- ➕ **Créer** : principal Polaris + rôles + miroir des droits du rôle, puis
  **credentials affichées une seule fois** (copie)
- 🔑 **Réinitialiser** : nouveau secret (l'ancien est invalidé), affiché une
  seule fois
- ✏️ **Changer de rôle** : réassignation + resynchronisation Polaris
- 🗑️ **Supprimer** : confirmation par ressaisie du nom ; le principal
  Polaris est supprimé

Le rôle `admin` est refusé : il hérite de tout sans grants explicites à
répliquer.

---

### Rôles

**Tableau des rôles** :

| Champ | Type | Description |
| --- | --- | --- |
| Nom | Texte | Nom du rôle |
| Description | Texte | Usage du rôle |
| Droits | Résumé | Nombre d'objets accessibles (lien vers l'éditeur) |
| Utilisateurs | Nombre | Comptes portant ce rôle |
| Actions | Icônes | Droits, Modifier, Supprimer |

**Éditeur des droits** (bouton « Droits ») : matrice
**Catalogues / Agents IA / Pipelines × Lecture / Écriture / Gestion** —
privilèges hiérarchiques, enregistrés serveur et répliqués en grants Polaris
réels pour les comptes applicatifs portant le rôle.

**Rôles par défaut** : Voir Rôles et Permissions

**Actions** :

- ➕ **Nouveau Rôle** : Création d'un rôle personnalisé

---

### Fournisseurs LLM

**Écran en deux colonnes** :

**1. Colonne gauche — Fournisseurs** :

| Fournisseur | Type | Modèles | Actions |
| --- | --- | --- | --- |
| Ollama (local) | Local | 3 modèle(s) | (embarqué par ParusDB) |
| OpenAI | OpenAI | 12 modèle(s) | Modifier / Supprimer |
| Mistral | Mistral | 6 modèle(s) | Modifier / Supprimer |

- **Ollama (local)** : toujours présent (serveur d'inférence embarqué),
  non supprimable. Les modèles locaux se téléchargent et se suppriment
  depuis cette page (voir ci-dessous).
- **Ajouter une clé API** : bouton → saisie du **nom du fournisseur** et de la
  **clé API**. Le type d'API (OpenAI, Anthropic, Mistral, compatible
  OpenAI) est **déduit automatiquement du nom** ; pour un fournisseur
  inconnu, une **URL de base** est demandée (API compatible OpenAI). La clé
  est **validée par un appel réel au fournisseur** : aucun enregistrement si
  elle est rejetée.
- **Télécharger un modèle local** : bouton (panneau Ollama) → saisie du
  **nom du modèle** tel que publié sur ollama.com (ex. `gemma3:4b`) →
  « Valider » lance le **téléchargement** sur le serveur Ollama, avec
  progression en temps réel (pourcentage, volume téléchargé). Un modèle
  déjà installé est refusé ; la fermeture de la fenêtre interrompt le
  téléchargement.
- **Supprimer un modèle local** : action par modèle (panneau Ollama) →
  confirmation par **ressaisie du nom** ; refusée si des agents utilisent
  encore le modèle.
- **Clé API** : chiffrée AES-256-GCM au repos, masquée dans l'interface,
  jamais renvoyée au navigateur.

**2. Colonne droite — Modèles disponibles** :

- Liste des **modèles LLM découverts dynamiquement** pour le fournisseur
  sélectionné à gauche (API de listing du fournisseur ; `/api/tags` pour
  Ollama), avec taille pour les modèles locaux.
- Sélectionner un fournisseur à gauche **filtre les modèles** à droite.
- Erreur de découverte (clé révoquée, fournisseur injoignable) : message
  explicite invitant à vérifier la clé via « Modifier ».

**Utilisation** : ces sources alimentent le champ « Source du modèle » du
formulaire d'agent.

---

## 📝 Notes Complémentaires

### Conventions d'Interface

- **Expiration de session** : la session se termine après **30 minutes d'inactivité**
  (OWASP : timeout d'inactivité obligatoire côté serveur ; la durée vise une plateforme
  data interne). À la reprise, l'utilisateur est ramené à la page de connexion — aucune
  donnée n'est perdue. La durée est configurable côté serveur
  (`SESSIONS_INACTIVITY_TIMEOUT`, cf. AGENTS.md §9) ; un réglage de 15 minutes peut être
  retenu pour des données sensibles.

- **Dark/Light/System Mode** : Sélecteur global en bas à gauche
- **Rôle actif** : Changement possible sans déconnexion
- **Confirmations sensibles** : Resaisie du nom pour les suppressions irréversibles (ex : catalogues)

### Intégration Technique

- **mcp-trino** (Model Context Protocol) : Serveur MCP connectant les agents LLM à Trino, pour interroger le Data Lakehouse
- **Supabase Realtime** : Gestion du chat temps réel entre utilisateur et LLM
- **Kong** : API Gateway pour router les requêtes vers les différents services

### Évolutions Futures

- [ ]  Intégration de nouveaux connecteurs
- [ ]  Durcissement Trino : HTTPS + authentification par mot de passe +
       access control généré depuis les grants RBAC (refus réel sur le chemin
       SQL — spécification de référence :
       `docs/functional/rbac_refonte.md` §9)
- [ ]  Fonctionnalités avancées de gouvernance

---

*Dernière mise à jour : 29 octobre 2026*