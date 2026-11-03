# Changelog

Tout changement notable de ParusDB est documenté ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/) ;
versionnement [SemVer](https://semver.org/lang/fr/).

## [Non publié]

## [1.0.0] — À paraître

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
