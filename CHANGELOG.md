# Changelog

Tout changement notable de ParusDB est documenté ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/) ;
versionnement [SemVer](https://semver.org/lang/fr/).

Politique de versionnage :

- **major** : rupture de compatibilité ; **minor** : nouvelle fonctionnalité
  compatible ; **patch** : correctif. Un bug corrigé avant le merge d'une PR
  ne produit pas de version : il est inclus dans la release suivante ;
- les tags de version sont posés **uniquement sur `main`**, après le merge de
  la PR, sur le commit final validé par la CI ;
- **un tag publié ne bouge plus jamais** : pas de `git tag -f`, pas de
  force-push de tag — les clones des utilisateurs embarquent les tags ;
- le nom de version est réservé aux tags : jamais de branche `vX.Y.Z`.

## [Non publié]

## [1.1.1] — 2026-11-11

### Corrigé

- **Première installation sur un clone frais** : le setup racine installe
  désormais les dépendances du frontend (`npm ci` manquant — échec
  « next: not found ») et régénère la clé de chiffrement si la valeur
  gabarit de `.env.example` subsistait (clé jamais tirée, cassant
  silencieusement `/data-lakehouse` et l'ajout de fournisseur LLM en 500
  muet) ; les actions admin renvoient désormais l'erreur de chiffrement
  en message affichable.
- **Erreurs de redirection affichées en toast** : les composants client
  attrapant l'erreur de `redirect()` affichaient « NEXT_REDIRECT »
  (création d'agent, assistant pipeline, boîte de confirmation) —
  `unstable_rethrow` relance désormais redirection et `notFound`.
- **Explorateur du lakehouse** : l'arborescence schémas/tables est
  rafraîchie après une requête réussie (un `CREATE`/`DROP` est visible
  immédiatement, sans recharger la page, onglets et résultats conservés).
- **Grants orphelins** : les grants de `iam.grants` survivant à la
  suppression du catalogue, agent ou pipeline visé (lignes fantômes dans le
  dialogue « Gérer les droits ») sont purgés en cascade par les actions de
  suppression, et `iam.has_grant` échoue fermé sur une ressource
  disparue (test T9a du harnais RLS).
- **Descriptions des pages** : les phrases d'architecture retirées des
  descriptions des pages lakehouse, connecteurs et administration.

### Modifié

- **Setup** : les warnings `ERESOLVE` de `npm ci` (peer ranges
  d'eslint-config-next arrêtées à eslint 9, résolution figée dans le
  lockfile) sont assourdis côté machine ; une installation manuelle
  reste verbeuse.
- **Documentation** : le harnais CI (`scripts/ci`) figure dans
  l'arborescence de référence du AGENTS.md.

## [1.1.0] — 2026-11-05

### Ajouté

- **Éditeur SQL multi-requêtes** : exécution séquentielle des requêtes
  séparées par « ; » (arrêt à la première erreur, privilège vérifié par
  requête, historique une ligne par requête). Le point-virgule terminal ou
  intermédiaire n'est plus une erreur de syntaxe.
- **Périmètre RBAC du Chat IA** : le LLM ne voit et n'interroge que les
  catalogues du rôle actif — liste injectée dans le prompt système,
  `list_catalogs` synthétisé depuis le RBAC, garde sur chaque appel d'outil
  et sur le SQL (identifiants quottés compris). L'allowlist de schémas
  `TRINO_ALLOWED_SCHEMAS` de mcp-trino est retirée : schémas et catalogues
  vivent dans les données, pas dans la configuration.

### Modifié

- **Premier message d'une conversation** : transite par la base
  (`chat.pending_first_messages`, lu et consommé au rendu) au lieu d'un
  paramètre d'URL — l'URL des conversations reste propre, un refresh ne
  renvoie pas le message déjà envoyé.
- **Documentation consolidée** : AGENTS.md et les README (nextjs, trino,
  mcp-trino) actent les retours d'expériences (grants des nouvelles tables,
  `await connection()` hors session, diagnostics LLM) et la règle « la
  configuration n'évolue pas à l'usage » ; Dependabot ignore les versions
  majeures incompatibles avec commentaire motivé (typescript 7.x,
  lucide-react 1.x).

### Corrigé

- **« Nouveau chat » bloqué** : le bouton d'envoi reste fonctionnel si la
  navigation traîne ou échoue (plus d'état « Ouverture… » figé), les erreurs
  de création s'affichent en notification.
- **Catalogues fantômes dans le chat** : `list_catalogs` ne dérive plus les
  catalogues vus par le compte de service MCP (`parusdb`, `system`…) —
  l'utilisateur n'a plus l'impression d'un accès dont il ne dispose pas.
- **Onboarding** : plus d'erreur « Blocking Route : unstable value
  Date.now() » au prerender dev de `/auth/onboarding`.
- **Compte mcp-trino** : catalogue `system` de Trino fermé explicitement
  dans les règles d'access control générées.

## [1.0.0] — 2026-11-04

Première release publique, sous licence Apache 2.0.

### Ajouté

- **Chat IA** : interrogation en langage naturel des données du lakehouse,
  streaming temps réel via Supabase Realtime, partage de conversations en
  lecture seule par rôle, titre généré par l'IA.
- **Agents IA personnalisables** : prompt système, sources par catalogue,
  LLM au choix — Ollama local (GPU) ou fournisseurs propriétaires par clé API
  (OpenAI, Anthropic, Mistral, compatible OpenAI), clés chiffrées au repos.
- **Data Lakehouse** : catalogues Apache Polaris + éditeur SQL Trino durci
  (HTTPS, authentification par mot de passe, access control généré depuis les
  grants RBAC), explorateur schémas → tables → colonnes, métriques disque
  Iceberg.
- **RBAC à grants** : rôles multiples + rôle actif, droits par objet
  (catalogues, agents, pipelines), propriété par rôle, comptes applicatifs
  pour les outils data, administration des utilisateurs, rôles et
  fournisseurs LLM.
- **Flux ELT** : moteur dlt (destination Iceberg via Polaris), 40+ sources
  (SQL, REST, filesystem, sources verified dlt), conteneur jetable par run,
  ordonnancement CRON, credentials chiffrés au repos, « Test connexion » par
  introspection réelle.
- **Authentification** : Supabase self-hosted, onboarding premier démarrage,
  expiration des sessions après inactivité.

[Non publié]: https://github.com/ParusDB/parusdb/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/ParusDB/parusdb/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/ParusDB/parusdb/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ParusDB/parusdb/releases/tag/v1.0.0
