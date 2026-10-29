# Refonte RBAC & Utilisateurs Applicatifs — Spécification de référence

> Branche : `feat/rbac_remake`
> Statut : **LIVRÉE** (commits `9105c44` → `1d71a03`, voir §8) et vérifiée
> (lint/tsc/build, tests RLS, e2e chat, `sh run.sh verify` dlt, installation
> complète rejouée sur base fraîche après reset).
> Ce document reste la source de vérité de la brique RBAC (le §9 spécifie
> l'évolution suivante : durcissement Trino) ; en cas de divergence, il fait
> foi pour cette brique.

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

## 7. Limitations assumées

1. **RBAC applicatif vs RBAC réel** : le RBAC des catalogues s'applique à
   l'application (l'éditeur SQL exige Lecture/Écriture via `iam.has_grant`,
   requêtes exécutées sous le compte de service du BFF) ; le RBAC réel
   Polaris protège le chemin Iceberg REST (Spark, Flink, pyiceberg, Airbyte,
   comptes applicatifs — 403 vérifié). **Trino reste sans authentification** :
   un outil connecté en direct au port Trino voit tous les catalogues —
   le durcissement Trino est spécifié au §9 et **décidé (option A)**.
2. La synchronisation des grants vers Polaris est éventuellement cohérente.
3. Les conversations partagées sont en lecture seule (pas d'envoi de message
   dans une conversation partagée).
4. `PRINCIPAL_ROLE:ALL` (client root) reste réservé au BFF pour l'API
   Management ; il n'est affiché nulle part.

---

## 8. État de livraison — inventaire de ce qui est en place

### 8.1 Base de données (`apps/supabase/sql/01-parusdb-app.sql`, idempotent)

- **Tables** : `iam.grants` (PK role_id × resource_type × resource_id,
  privileges `text[]` ⊆ {read, write, manage}) ; `iam.app_users` (clientId
  sans secret, `credentials_rotated_at`, FK rôle `ON DELETE RESTRICT`) ;
  `chat.conversation_shares`.
- **Propriété** : `owner_role_id` (FK `ON DELETE RESTRICT` vers `iam.roles`)
  sur `agents.agents`, `connectors.pipelines`, `lakehouse.catalog_registry` ;
  posées **tôt** dans le fichier (les fonctions y font référence).
- **Supprimé** : `iam.roles.permissions`, `lakehouse.catalog_access`,
  `iam.has_permission`.
- **Fonctions** : `iam.is_admin`, `iam.privilege_rank`,
  `iam.has_grant` — **PLPGSQL** (leçon d'incident : une fonction SQL est
  validée à la création et référençait des tables créées plus bas ; sur base
  fraîche la transaction unique avortait, PostgREST restait unhealthy),
  `chat.can_manage_share` (SECURITY DEFINER — les politiques des partages ne
  doivent JAMAIS référencer `chat.conversations` directement : récursion RLS).
- **RLS** entièrement réécrite sur le rôle actif : listes filtrées par
  `iam.has_grant`, conversations partagées lisibles mais non modifiables
  (écriture/suppression réservées au propriétaire), **destination
  d'ingestion exigeant `write` sur le catalogue dans le WITH CHECK** des
  pipelines, suppression = `manage`.
- **Trigger** `on_auth_user_created` : `admin` au premier compte, `public`
  ensuite (l'onboarding attribue explicitement le rôle).
- **Seed** `02-lakehouse-catalogs.sql` : descriptions des catalogues
  d'installation + propriété `admin` (backfill `owner_role_id`) — plus de
  `catalog_access`.
- **Migration** : users technique/metier → `public` ; objets existants →
  propriété `admin` (redistribution manuelle ensuite).
- **Tests** : `apps/supabase/sql/tests/rls-rbac-test.sql` — 26 assertions,
  rejouable sur base fraîche (rôle admin du trigger neutralisé pour les
  fixtures ; section admin T7/T8b sautée tant qu'aucun compte n'existe).
- `setup.sh` racine : application du schéma en fail-fast (`ON_ERROR_STOP` +
  code de sortie) — un échec ne s'affiche plus comme un succès.

### 8.2 Serveur TypeScript (`apps/nextjs`)

- `lib/session.ts` : `requireSession`, `requireAdmin`, `requireGrant` /
  `hasGrant` (RPC `iam.has_grant`, schéma `iam` explicite) — fin de
  `requirePermission`.
- `lib/rbac.ts` : grants du rôle actif, calcul des capacités par objet,
  catalogues lisibles / destinations d'ingestion (`write`).
- `lib/permissions.ts` : métadonnées ressources × privilèges (labels FR).
- `lib/polaris.ts` : principals Polaris (création / **`/reset`** /
  suppression — secret retourné une seule fois), principal-roles,
  catalog-roles, grants (spec 1.8 : **un PUT par privilège singulier**),
  `syncRoleCatalogAccess` (miroir complet, ajouts ET retraits).
- `lib/connection-info.ts` : adresses publiques (Trino, Polaris REST +
  OAuth2, S3 path-style) dérivées de `PARUSDB_PUBLIC_HOST` (défaut
  localhost) ; clés S3 optionnelles.
- Pages/actions : création pose `owner_role_id` = rôle actif ; éditeur SQL :
  Lecture pour un SELECT (`select|show|describe|desc|explain` en tête),
  Écriture pour toute requête modifiante ; listes et boutons selon les
  privilèges effectifs ; destination de pipeline limitée aux catalogues
  `write`.

### 8.3 Interface

- Sidebar : menus fonctionnels visibles par tous, contenu filtré par rôle
  actif ; Administration si rôle `admin` (ordre : Informations, Utilisateurs,
  Rôles, Fournisseurs LLM) ; sélecteur de rôle actif conservé ; actions
  contextuelles selon les privilèges.
- `/admin/roles` : rôles + **éditeur de grants** (onglets Catalogues /
  Agents IA / Pipelines × Lecture / Écriture / Gestion ; hiérarchie à la
  saisie et serveur ; resynchronisation Polaris best effort avec
  avertissement).
- `/admin/users` : onglets **Humains** (rôles multiples, rôle actif toujours
  valide après retrait) / **Applicatifs** (création → credentials Polaris
  affichées une fois, réinitialisation, changement de rôle avec resync,
  suppression avec ressaisie ; rôle `admin` refusé).
- `/chat/[id]` : bouton Partager à côté du crayon, partages révocables,
  conversations partagées en lecture seule (badge, composer masqué, refus
  403 côté route de stream).
- `/admin/informations` : avertissement réseau privé, sélecteurs compte
  applicatif × catalogue (limités aux droits du rôle), sections dbt / JDBC /
  Power BI / Spark / Flink / pyiceberg / Airbyte avec snippets copiables
  préremplis du scope `PRINCIPAL_ROLE:<rôle>` — le secret apparaît en
  marqueur, jamais stocké ni réaffiché.

### 8.4 Miroir Polaris — pièges API validés en live (1.8.0)

- Création : `POST /api/management/v1/principals` →
  `{principal, credentials}` (secret UNE fois) ; **rotation : `/reset`**
  (`Content-Type: application/json` requis même avec body vide) — `/rotate`
  est refusé au client root (bug #624) ;
- grants : **un PUT par privilège singulier** (`{grant:{type:"catalog",
  privilege:"…"}}`) ; POST sur le même chemin = RÉVOCATION ;
- assignations par **PUT sur la collection avec body**
  (`/principals/{n}/principal-roles`, `/principal-roles/{r}/catalog-roles/{cat}`) ;
- mapping privilèges : Lecture → `CATALOG_READ_PROPERTIES`, `NAMESPACE_LIST`,
  `NAMESPACE_READ_PROPERTIES`, `TABLE_LIST`, `TABLE_READ_PROPERTIES`,
  `TABLE_READ_DATA` ; Écriture → + `NAMESPACE_CREATE`,
  `NAMESPACE_WRITE_PROPERTIES`, `TABLE_CREATE`, `TABLE_WRITE_PROPERTIES`,
  `TABLE_WRITE_DATA` ; Gestion → `CATALOG_MANAGE_CONTENT` ;
- conventions : principal = nom du compte applicatif, principal-role = key
  du rôle ParusDB, catalog-role = `<roleKey>_access` (décrit au §4).

### 8.5 Documentation & environnement

- Spec fonctionnelle §7 + menus + §Administration à jour ; README racine,
  `apps/nextjs/README.md`, `apps/trino/README.md` alignés ; AGENTS.md
  §6/§7/§9/§10 à jour.
- `setup.sh` : sync `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` vers
  `.env.local` ; `.env.example` documenté (`PARUSDB_PUBLIC_HOST`, clés S3).

---

## 9. Évolution suivante — Durcissement Trino (option A, VALIDÉE)

> Objectif : rendre le refus réel sur le **chemin Trino** (dbt, Power BI,
> clients JDBC/ODBC), qui aujourd'hui contourne le RBAC. Décidé : HTTPS +
> password file + file access control **généré depuis `iam.grants`** —
> l'admin ne change pas d'UX, Trino devient un artefact dérivé (comme les
> bindings de catalogues). Principe : **les humains ne reçoivent pas de
> compte Trino** — ils passent par l'UI (le BFF applique `iam.has_grant`
> côté éditeur SQL) ; seuls les comptes applicatifs parlent à Trino.

### 9.1 Briques Trino (config vérifiée sur la doc officielle)

| Brique | Configuration |
|---|---|
| **HTTPS** | `http-server.https.enabled=true`, `http-server.https.port=8443`, keystore self-signed généré au setup (`apps/trino/setup.sh`, chemin/secret dans `.env` — jamais commités). Obligatoire : Trino refuse le password sur HTTP. |
| **Authentification** | `http-server.authentication.type=PASSWORD` ; `etc/password-authenticator.properties` : `password-authenticator.name=file`, `file.password-file`, `file.refresh-period` (défaut 5 s — **rechargement sans redémarrage**). Format : `user:bcrypt` (`$2y$`, cost ≥ 8, `htpasswd -B -C 10`). |
| **Access control** | `etc/access-control.properties` : `access-control.name=file`, `security.config-file=…`, `security.refresh-period` (rechargement sans redémarrage). JSON de règles : `catalogs` (`user`/`catalog` regex + `allow: all|read-only|none`), `schemas` et `tables` (`privileges`: `SELECT`, `INSERT`, `DELETE`, `UPDATE`, `OWNERSHIP`). **Première règle qui matche s'applique ; sans correspondance = refus.** |

### 9.2 Génération depuis `iam.grants` (source de vérité unique)

Un compte applicatif `X` de rôle `R` reçoit **à sa création** : ses
credentials Polaris (existant) **ET** une ligne `X:<bcrypt>` dans le fichier
de mots de passe Trino. Le JSON de règles est régénéré à chaque modification
de grants (même déclencheur que la resync Polaris) :

| Grant ParusDB sur le catalogue C | Règles Trino pour l'utilisateur X |
|---|---|
| `read` | `catalogs`: `{user: X, catalog: C, allow: read-only}` + `tables`: `SELECT` sur `C.*.*` |
| `write` | `catalogs`: `allow: all` + `tables`: `SELECT`, `INSERT`, `DELETE`, `UPDATE` sur `C.*.*` |
| `manage` | idem write + `schemas`: `OWNERSHIP` sur `C.*` (créer/supprimer des schémas et tables) |

- Le **BFF** garde son compte de service (user `TRINO_USER` + nouveau
  `TRINO_PASSWORD` env, droits larges : les règles ne le contraignent pas —
  l'UI applique elle-même `iam.has_grant`).
- La rotation des credentials applicatives régénère **Polaris + Trino**
  ensemble (même parcours `/admin/users`).
- `/admin/informations` : snippets passent de `method: none` à
  authentification par mot de passe (dbt : `method: ldap` + `cert` /
  `TRINO_SSL_CERT` ; Power BI : `AllowSelfSignedServerCert=1` ; JDBC :
  `SSL=true`). Port public Trino : 8443 (via `PARUSDB_PUBLIC_HOST`).
- Révocation d'un grant → règles régénérées → refus immédiat (refresh
  périodique, sans redémarrage Trino).

### 9.3 Limites assumées (inchangées par rapport à l'analyse)

1. Granularité **schéma/table** seulement : masques de colonnes et filtres
   de lignes = Trino/Starburst Enterprise uniquement. La granularité fine
   (agents, chat, partages) reste portée par le RBAC applicatif.
2. HTTPS self-signed : friction client documentée dans
   `/admin/informations`.
3. Deux secrets par compte applicatif (Polaris + Trino), créés et rotés
   ensemble dans le même parcours.
4. `SHOW CATALOGS` reste autorisé (visible) mais l'accès aux données est
   refusé par les règles — à vérifier en dev et documenter si besoin.

### 9.4 Points d'implémentation à traiter en dev

- `apps/trino/docker-compose.yml` + `setup.sh` : port 8443 exposé,
  génération du keystore (openssl/keytool), écriture de
  `etc/config.properties` (auth), `password-authenticator.properties`,
  `access-control.properties` ; fichiers mots de passe + règles générés par
  l'app (répertoire dédié, monté en bind comme `TRINO_CATALOG_DIR`).
- `lib/polaris.ts` / actions admin : à la création/rotation/suppression
  d'un compte applicatif et à chaque `setRoleGrant` catalogue → générer
  password.db (bcrypt) + rules.json.
- `lib/trino.ts` : trino-js-client en HTTPS + basic auth
  (`server: https://…`, credentials `TRINO_USER`/`TRINO_PASSWORD`) —
  vérifier le support TLS self-signed du client Node.
- La suppression de compte applicatif retire sa ligne du password.db
  (révocation immédiate).
- Tests : 403 réel sur un catalogue non accordé via un compte applicatif
  Trino ; requête SELECT/DDL conforme au mapping ; refresh sans redémarrage.
- Vérification complète : `npm run lint`, `npx tsc --noEmit`,
  `npm run build`, tests RLS rejoués, test e2e chat (`apps/ollama
  sh run.sh test`), `sh run.sh verify` dlt.

---

## 10. Reste à faire — checklist de passation

- [ ] **Durcissement Trino** (§9, option A validée) — à développer dans une
      nouvelle conversation sur la même branche ou une suite de PR.
- [ ] **Passage UI manuel** : `cd apps/nextjs && npm run dev` puis vérifier
      onboarding (premier compte admin), création d'un compte applicatif,
      distribution de droits dans /admin/roles, /admin/informations,
      partage de conversation. (Jamais testé en conditions réelles : le
      serveur Next n'était pas joignable pendant la refonte.)
- [ ] **Prompt socle du chat** (`lib/agent-runner.ts`) : renforcer l'indice
      sur les dates relatives — le modèle boucle parfois sur `INTERVAL
      'n months'` (syntaxe rejetée par Trino) ; exiger
      `date_add('month', -3, current_date)` (4 échecs e2e sur 5 runs du
      29/10, succès au rejeu).
- [ ] **PR de la branche** `feat/rbac_remake` vers `main` (une PR par étape
      ou une PR de refonte avec le présent document en description).
