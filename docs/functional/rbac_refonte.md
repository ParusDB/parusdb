# Refonte RBAC & Utilisateurs Applicatifs — Spécification de l'évolution

> Branche : `feat/rbac_remake`
> Statut : spécification de référence de l'évolution. La spec fonctionnelle
> (`functional_specifications.md`, §7 « Rôles et Permissions ») sera mise à jour
> pour refléter ce modèle une fois l'évolution livrée ; en cas de divergence
> pendant le développement, ce document fait foi pour la brique RBAC.

---

## 1. Motivation

Le RBAC actuel repose sur des **permissions statiques de menu** (`chat`, `agents`,
`lakehouse`, `connectors`, `admin.*` : colonne `iam.roles.permissions`) et trois rôles
système figés (`admin`, `technique`, `metier`). Ce modèle :

- ne permet pas de délimiter l'accès **par objet** (catalogue, agent, pipeline) ;
- ne correspond pas au fonctionnement du lakehouse sous-jacent : **Apache Polaris**
  applique un RBAC à grants (`principal` → `principal role` → `catalog role` →
  `privileges`) que ParusDB n'exploite pas ;
- ne permet pas de créer des **comptes applicatifs** (service accounts) pour les
  outils data externes (dbt, Power BI, Airbyte, Spark, Flink, pyiceberg), qui doivent
  se connecter au catalogue Polaris avec leurs propres credentials et un accès
  circonscrit.

L'évolution aligne le RBAC applicatif de ParusDB sur le modèle de Polaris, ajoute la
notion d'accès aux **agents IA** et aux **chats**, et introduit la gestion des
**utilisateurs applicatifs**.

---

## 2. Modèle cible

### 2.1 Concepts (calqués sur Polaris)

| Polaris | ParusDB |
| --- | --- |
| Principal | **Compte** : humain (authentification Supabase, accès à l'UI) ou applicatif (outil data, accès au catalogue Iceberg via Polaris) |
| Principal role | **Rôle** applicatif (groupement nommé) |
| Catalog role (privilèges sur un catalogue) | **Grants** ParusDB : privilèges sur une ressource |
| Privileges (`TABLE_READ_DATA`, `CATALOG_MANAGE_CONTENT`…) | `read` / `write` / `manage` par type de ressource |

### 2.2 Comptes

- **Humains** : comptes d'authentification existants (`auth.users`). Le premier
  compte créé (onboarding) reçoit le rôle `admin` ; **tous les suivants reçoivent
  le rôle `public`**, qui n'a accès à aucun objet. L'administrateur attribue
  ensuite des rôles via `/admin/users`.
- **Applicatifs** : créés par un admin via `/admin/users` (onglet « Applicatifs »).
  Chaque compte applicatif :
  - porte un **nom** (ex. `airbyte-prod`), une **note** d'usage et un **rôle**
    ParusDB qui détermine ses accès (les grants de catalogues du rôle sont
    répliqués en vrais grants Polaris) ;
  - correspond à un **principal Polaris** (credentials OAuth2
    `clientId`/`clientSecret`, scope `PRINCIPAL_ROLE:<nom du rôle>`) ;
  - voit son **clientSecret une seule fois** à la création ou à la
    réinitialisation — jamais persisté en clair par ParusDB.

### 2.3 Rôles

- Rôles **système** (non supprimables) :
  - `admin` — hérite de tout : accès complet implicite à toutes les ressources,
    quelle que soit la table des grants ;
  - `public` — attribué par défaut aux nouveaux comptes ; aucun accès.
- Rôles **custom** : créés par l'admin via `/admin/roles` (ex. `data_engineer`,
  `sales`). Un compte peut porter **plusieurs rôles** et **sélectionne un rôle
  actif** (obligatoire ; premier rôle par défaut). **Toutes les décisions
  d'accès aux objets s'évaluent sur le rôle actif.**
- Le menu **Administration** est visible et accessible uniquement aux comptes
  ayant le rôle `admin` (indépendamment du rôle actif : l'administration est une
  capacité du compte, pas un périmètre de données).

### 2.4 Ressources et privilèges

| Ressource | `read` | `write` | `manage` |
| --- | --- | --- | --- |
| **Catalogue** | voir le catalogue, ses schémas et tables ; exécuter des requêtes en lecture dans l'éditeur SQL | créer/modifier des objets via l'éditeur SQL ; **être une destination d'ingestion** (pipeline) | modifier/supprimer le catalogue, gérer les accès |
| **Agent IA** | voir l'agent, discuter avec lui (nouvelles conversations) | modifier l'agent et ses sources | supprimer l'agent, gérer l'accès |
| **Pipeline** | voir le pipeline, son statut, son historique | modifier, lancer, désactiver | supprimer |

### 2.5 Propriété

- **Le rôle actif qui crée un objet en devient le propriétaire** :
  `owner_role_id` sur `agents.agents`, `connectors.pipelines`,
  `lakehouse.catalog_registry`. Tous les comptes portant ce rôle (actif) voient
  l'objet et disposent de tous les privilèges dessus.
- **Exception — les chats** : les conversations appartiennent au **compte**
  (`owner_id`), pas au rôle. Le propriétaire peut, depuis la conversation
  (bouton « Partager » à côté du crayon de renommage), autoriser l'accès en
  **lecture seule** aux comptes partageant l'un de ses rôles ; le partage est
  révocable. Les conversations partagées apparaissent dans la liste des membres
  du rôle (badge « Partagé »), sans possibilité d'y écrire.

### 2.6 Cross-role : distribution des droits

L'admin crée des rôles et distribue les droits via `/admin/roles` : par rôle, une
matrice de grants (onglets Catalogues / Agents / Pipelines × read / write / manage).
Exemple : le rôle `sales` n'a accès qu'aux catalogues `sales` et `orders` → il ne
peut ingérer que vers ces catalogues, et `/connectors` ne lui montre que les
pipelines du rôle `sales`.

---

## 3. Modèle de données (PostgreSQL applicatif)

### Nouvelles tables

```
iam.grants (
  role_id          uuid → iam.roles (cascade),
  resource_type    text  check in ('catalog', 'agent', 'pipeline'),
  resource_id      text,          -- nom du catalogue, id d'agent/pipeline
  privileges       text[] check ⊆ {read, write, manage},
  created_by       uuid → auth.users (set null),
  created_at / updated_at timestamptz,
  primary key (role_id, resource_type, resource_id)
)

iam.app_users (
  id                       uuid pk,
  name                     text unique,   -- ex. airbyte-prod
  note                     text,
  role_id                  uuid → iam.roles (restrict),
  polaris_client_id        text not null,
  credentials_rotated_at   timestamptz,
  created_by               uuid → auth.users (set null),
  created_at / updated_at timestamptz
)  -- jamais de client_secret stocké

chat.conversation_shares (
  conversation_id  uuid → chat.conversations (cascade),
  role_id          uuid → iam.roles (cascade),
  granted_by       uuid → auth.users (set null),
  created_at       timestamptz,
  primary key (conversation_id, role_id)
)
```

### Tables modifiées

- `iam.roles` : suppression de la colonne `permissions` ; `is_system` couvre
  désormais `admin` et `public`.
- `agents.agents` : `owner_role_id` (le `owner_id` existant sert de traçabilité
  « créé par », conservé).
- `connectors.pipelines` : `owner_role_id`.
- `lakehouse.catalog_registry` : `owner_role_id`.
- **Suppression** de `lakehouse.catalog_access` (remplacée par `iam.grants`).

### Fonctions d'autorisation

- `iam.is_admin(p_user)` : le compte porte le rôle `admin`.
- `iam.has_grant(p_user, p_resource_type, p_resource_id, p_privilege)`
  (SECURITY DEFINER, schéma non exposé à l'anonyme) : `true` si
  1. `is_admin`, sinon
  2. le rôle actif est `owner_role_id` de la ressource, sinon
  3. le rôle actif a un grant contenant le privilège sur la ressource.
- Suppression de `iam.has_permission` ; toutes les politiques RLS et le code
  serveur sont réécrits sur `iam.has_grant` / `iam.is_admin`.

---

## 4. Miroir Polaris (utilisateurs applicatifs)

À la création d'un compte applicatif de rôle R :

1. principal Polaris `name` → credentials (retournés une seule fois) ;
2. principal-role Polaris nommé comme le rôle ParusDB R ;
3. pour chaque catalogue avec un grant sur R : catalog-role Polaris portant les
   privilèges équivalents (`read` → `TABLE_LIST`, `TABLE_READ_PROPERTIES`,
   `TABLE_READ_DATA`, `NAMESPACE_LIST`, `NAMESPACE_READ_PROPERTIES`,
   `CATALOG_READ_PROPERTIES` ; `write` → + `TABLE_WRITE_DATA`, `TABLE_CREATE`,
   `TABLE_WRITE_PROPERTIES`, `NAMESPACE_CREATE`, `NAMESPACE_WRITE_PROPERTIES` ;
   `manage` → `CATALOG_MANAGE_CONTENT`) ;
4. catalog-roles accordés au principal-role, principal-role accordé au principal.

Toute modification des grants de catalogues d'un rôle déclenche la
**resynchronisation** des comptes applicatifs portant ce rôle (recréation des
catalog-roles/grants Polaris ; un objet Polaris manquant est recréé, un grant
retiré est révoqué). La synchronisation est éventuellement cohérente : un échec
apparaît dans l'UI d'administration sans bloquer l'édition applicative.

Le token des comptes applicatifs est toujours demandé avec le scope
`PRINCIPAL_ROLE:<nom du rôle>` — jamais `PRINCIPAL_ROLE:ALL` (réservé au client
root, utilisé uniquement côté serveur BFF pour l'API Management).

---

## 5. Interface

### 5.1 Navigation

- Chat, Agents IA, Data Lakehouse, Connecteurs : visibles par **tous** les
  comptes authentifiés ; leur **contenu** dépend du rôle actif (listes vides si
  aucun objet accessible).
- Administration (Informations, Utilisateurs, Rôles, Fournisseurs LLM) :
  visible si le compte a le rôle `admin`. Ordre : **Informations** au-dessus de
  « Utilisateurs ».
- Sélecteur de rôle actif conservé (zone utilisateur, en bas de la sidebar).

### 5.2 Pages modifiées

- **`/admin/users`** : deux onglets.
  - **Humains** : tableau existant + attribution de rôles multiples.
  - **Applicatifs** : tableau (nom, rôle, clientId, note, dates) ; création
    (nom, rôle, note) → modale credentials (copie, affichage unique) ; actions
    réinitialiser les credentials (nouveau secret affiché une fois), changer le
    rôle, supprimer (confirmation).
- **`/admin/roles`** (refonte) : liste des rôles (badge système pour
  `admin`/`public`), création/édition/suppression des customs ; par rôle, la
  matrice des grants (Catalogues / Agents / Pipelines × read / write / manage).
- **`/chat/[id]`** : bouton « Partager » à côté du crayon → dialogue « Autoriser
  l'accès aux utilisateurs partageant le rôle… » ; liste des partages actifs,
  révocables. Conversations partagées en lecture seule pour les membres.
- **Pages objet** (lakehouse, agents, connectors) : listes et actions filtrées
  par rôle actif via `iam.has_grant` ; création pose `owner_role_id` = rôle
  actif ; création de pipeline : destinations limitées aux catalogues `write`
  du rôle actif.

### 5.3 Nouvelle page : `/admin/informations`

Objectif : rendre le lakehouse consommable par des outils data externes, avec
les credentials applicatives (jamais le client root).

Contenu :

1. Avertissement : connexions en HTTP, Trino sans authentification — usage
   réservé au réseau privé.
2. Utilisateurs applicatifs : sélecteur du compte applicatif → tous les
   snippets sont préremplis avec ses credentials et son scope.
3. Informations générales : URLs Trino (`host:8080`), Polaris
   (`/api/catalog`, `/api/catalog/v1/oauth/tokens`), endpoint S3 RustFS
   **public** (dérivé : `localhost` par défaut, variable `PARUSDB_PUBLIC_HOST`
   en surcharge — `POLARIS_S3_ENDPOINT=http://rustfs:9000` étant interne au
   réseau Docker), bucket, région, clés S3 (masquées, révélation ponctuelle).
4. Sections par outil (snippets copiables) :
   - **dbt** (`dbt-trino`) : `profiles.yml` (host, port, user, database =
     catalogue, schema, `http_scheme: http`, `method: none`) ;
   - **Power BI** : connecteur Starburst/ODBC (Host, Port, Catalog) ;
   - **JDBC générique** : `jdbc:trino://host:8080/catalog` ;
   - **Spark / Flink / pyiceberg** : catalogue REST Polaris (`uri`,
     `oauth2-server-uri`, `warehouse`, `credential`, `scope`,
     `X-Iceberg-Access-Delegation: vended-credentials`) ;
   - **Airbyte** (destination « S3 Data Lake ») : champ par champ (Polaris
     Server URI, Catalog Name, Client ID/Secret, OAuth Scope, OAuth2 Server
     URI, Default namespace, Warehouse location, S3 Endpoint + clés S3).

---

## 6. Migration des données existantes

- Rôles `technique` et `metier` **supprimés**. Les comptes non-admin les portant
  sont migrés vers `public`.
- Les objets existants (agents, pipelines, catalogues) reçoivent
  `owner_role_id` = `admin` : la plateforme démarre verrouillée côté objets,
  l'admin redistribute les droits (choix assumé : la propriété historique par
  compte n'est pas traduite en propriété par rôle).
- Les conversations restent la propriété de leur créateur ; aucun partage
  initial.
- `lakehouse.catalog_access` est supprimée ; aucun contenu à migrer (les
  catalogues reçoivent `owner_role_id` = `admin`).

---

## 7. Limitations assumées (à documenter dans la PR)

1. **RBAC applicatif vs RBAC réel** : le RBAC des catalogues s'applique à
   l'application (Trino est interrogé sous un utilisateur unique) ; le RBAC
   réel Polaris ne protège que le chemin Iceberg REST (Spark, Flink, pyiceberg,
   Airbyte, comptes applicatifs). **Trino reste sans authentification** : un
   outil connecté en direct à Trino voit tous les catalogues — le durcissement
   (password authenticator + access control Trino) est un chantier séparé.
2. La synchronisation des grants vers Polaris est éventuellement cohérente.
3. Les conversations partagées sont en lecture seule (pas d'envoi de message
   dans une conversation partagée).
4. `PRINCIPAL_ROLE:ALL` (client root) reste réservé au BFF pour l'API
   Management ; il n'est affiché nulle part.

---

## 8. Étapes de livraison (une PR par étape sur `feat/rbac_remake`)

1. **SQL** : tables, fonctions, RLS, seed, migration — vérifié par requêtes de
   test RLS.
2. **Session & pages** : `lib/session.ts`, fin de `requirePermission`,
   visibilité par rôle actif sur toutes les pages/actions.
3. **Chat** : partage de conversation (lecture seule).
4. **`/admin/roles`** : éditeur de rôles et de grants.
5. **`/admin/users`** : onglet Applicatifs + lib Polaris (principals,
   credentials, miroir des grants).
6. **`/admin/informations`** : page de connexion des outils.
7. **Docs & env** : spec fonctionnelle §7 + §Administration, AGENTS.md,
   synchronisation des clés S3, `PARUSDB_PUBLIC_HOST`.
8. **Vérification** : `npm run lint`, `npx tsc --noEmit`, `npm run build`,
   test e2e chat, `sh run.sh verify` dlt, tests RLS rejoués.
