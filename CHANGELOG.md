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

[Non publié]: https://github.com/ParusDB/parusdb/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ParusDB/parusdb/releases/tag/v1.0.0
