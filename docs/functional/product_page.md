# Fiche produit de ParusDB – La plateforme Data Analytique IAgentique Open Source

## **📌 Pitch**

ParusDB est une **plateforme data analytique open source** qui **unifie ELT, Data Lakehouse et agents IA**.

> « ParusDB unifie ELT, Data Lakehouse et agents IA dans une plateforme open source et souveraine. Déployez-la vous-même, contribuez, ou utilisez-la gratuitement. »
> 
- **100% Open Source** sous **licence Apache 2.0** : dépôt public sur GitHub — forkez, contribuez, déployez où vous voulez. Aucune dépendance ferme, aucun vendor lock-in.
- **Auto-hébergement** par défaut : un simple `sh setup.sh` et l'instance est prête **en 5 minutes**.
- **Souveraineté totale** : vos données restent sous votre contrôle absolu, aucune donnée ne quitte votre infrastructure.
- **Libre d'utilisation** : aucune redevance, aucune limite. Juste du code, des conteneurs, et la liberté de déployer où vous voulez.

Une plateforme où l'IA agentique est au cœur de chaque interaction avec les données : **« Vos données, enfin parlantes. »**

---

## **🎯 Problème Résolu**

**Assembler une Modern Data Stack, c'est long, cher, fragile.** Avec les solutions propriétaires : licences élevées, vendor lock-in, aucun contrôle sur vos données.

- **Silos** — Données dispersées : CRM, ERP, fichiers, cloud… Vos données sont partout, l'insight nulle part. Les solutions propriétaires vous obligent à tout centraliser chez elles.
- **Lock-in** — Dépendance aux vendors : une fois vos données dans un outil SaaS, elles y restent. Migrer est long, coûteux, souvent impossible.
- **Opacité** — Manque de transparence : vous ne savez pas comment vos données sont traitées, où elles sont stockées, et vous ne pouvez pas auditer le code qui les manipule.

**ParusDB supprime ces barrières** avec une plateforme **unifiée** (ELT + Data Lakehouse + agents IA), **open source, auditable et souveraine**, où chaque équipe interroge ses données en langage naturel via des agents IA, et où le déploiement se fait **en minutes, pas en mois**.

---

## **👥 Public Cible**

- **Équipes métiers** (commercial, support, direction, finance…) : besoin d'insights rapides et sourcés. « Chaque équipe, son agent. Chaque question, sa réponse. » Une fois l'instance installée, l'interface est **accessible à tous sans écrire de code**.
- **Équipes techniques** : des **bases en Docker et configuration serveur suffisent** pour déployer ; RBAC, gouvernance et permissions granulaires par catalogue.
- **Développeurs et communauté open source** : contributions ouvertes (fork, branche, Pull Request, issues, GitHub Discussions) ; connecteurs et agents **extensibles par la communauté**.

---

## **⚙️ Fonctionnalités Clés — « Une plateforme, cinq briques »**

« Tout ce qu'il faut pour passer de la donnée brute à la décision. »

### **1. Un chat IA qui parle votre métier**

- **Interrogation en langage naturel** : posez vos questions comme à un expert (ex : *« Quel est le panier moyen par région ce trimestre ? »*).
- L'agent **choisit le bon catalogue**, **écrit le SQL** et **restitue les données**.
- **Réponses sourcées** : chiffres, tableaux et graphiques, **visualisées et exportables**.

### **2. Agents IA personnalisables**

- **Pré-instructions** pour guider le comportement de chaque agent ; **sources associées** (catalogues de données).
- **LLM au choix par agent** : modèles **open source** (Mistral, Qwen…) **exécutés en local** via Ollama, ou modèles **propriétaires** (OpenAI, Anthropic) **via clé API**.
- **Un agent par usage** : ventes, support, finance. **Extensibles par la communauté**.

### **3. Data Lakehouse intégré**

- **Catalogue Iceberg + Moteur SQL + Object Storage S3** (Iceberg Tables + Trino).
- « La puissance d'une stack moderne, sans l'assembler. Tout en open source. »

### **4. 40+ connecteurs prêts à l'emploi**

- Sources : Snowflake, PostgreSQL, Salesforce, HubSpot, Notion, BigQuery, Stripe, Shopify, SQL Server, S3…
- **Ingestion incrémentale**, **ordonnancement CRON**, **glisser-déposer de fichiers**.
- **Extensibles** — « Et vous pouvez en ajouter ! »

### **5. RBAC & gouvernance**

- **Profils métiers, techniques, admin**.
- **Permissions granulaires par catalogue**.
- **Rôles multiples**, **rôle actif au switch**.

### **Brique transversale : 100% Open Source — Licence Apache 2.0**

- **Code source complet et transparent sur GitHub** : forkez le dépôt, contribuez, déployez où vous voulez.
- **Aucune dépendance ferme, aucun vendor lock-in.**

---

## **🚀 Fonctionnement — « Déployez et utilisez ParusDB en quatre étapes simples »**

1. **Clonez le dépôt** : code source sur GitHub, open source sous licence Apache 2.0. Pas de restriction, pas de coût caché.
2. **Déployez avec Docker** : `git clone <https://github.com/ParusDB/parusdb.git`>, puis `sh setup.sh` (la stack complète s'installe et démarre). Au premier lancement, l'interface guide la création du compte **Administrateur** — aucune commande en terminal. Auto-hébergée, sous votre contrôle.
3. **Connectez vos sources** : choisissez parmi 40+ connecteurs, configurez vos connexions, sélectionnez vos tables. L'ingestion démarre immédiatement.
4. **Discutez avec vos données** : configurez vos agents IA et posez vos questions en langage naturel. Réponses sourcées, visualisées, exportables.

---

## **🛡️ Souveraineté & Sécurité**

« Vos données, sous votre contrôle total. »

- **Déploiement 100% sous votre contrôle** : votre propre serveur, votre cloud préféré, ou en local. Aucune dépendance extérieure, aucun lock-in.
- **Portable** : Docker, Kubernetes, bare metal… Vous choisissez l'environnement.
- **BYO tout** : infrastructure, S3, LLM, cloud. Par défaut vous auto-hébergez ; l'hybride est possible avec votre propre S3 et vos propres LLM.
- **Chiffrement au repos et en transit · Conforme RGPD** : aucune donnée ne quitte votre infrastructure.
- **Code ouvert, auditable, transparent** (Licence Apache 2.0).

---

## **✨ Avantages Clés**

| **Bénéfice** | **Détail** |
| --- | --- |
| **100% Open Source** | Licence Apache 2.0, libre d'utilisation, code transparent sur GitHub. |
| **Souveraineté totale** | Auto-hébergement, BYO tout (S3, LLM, infrastructure), aucune donnée ne quitte votre infrastructure. |
| **Déploiement en minutes** | `sh setup.sh`, instance prête en 5 minutes — « pas en mois ». |
| **Accessibilité** | Interface utilisable sans écrire de code une fois installée ; bases Docker/serveur suffisantes pour déployer. |
| **Sécurité & RGPD** | Chiffrement au repos et en transit, RBAC, permissions granulaires. |
| **Zéro vendor lock-in** | « Aucune dépendance ferme » ; vos données restent déplacées librement. |

---

## **🔍 Différenciation — ParusDB vs solutions SaaS/propriétaires**

| **Fonctionnalité** | **ParusDB** | **Solutions SaaS** |
| --- | --- | --- |
| Agents IA personnalisables par métier | Oui | — |
| Data Lakehouse intégré (Object Storage S3 + Iceberg Tables + Trino) | Oui | Souvent séparé |
| Connecteurs ELT natifs (40+) — extensibles | Oui | Via 3rd party |
| Souveraineté totale (auto-hébergement) | Oui | Cloud propriétaire |
| LLM open source exécuté en local | Oui | API propriétaires |
| Code source transparent et modifiable | Oui | — |
| Pas de vendor lock-in | Oui | — |
| Communauté et contributions ouvertes | Oui | — |
| Libre d'utilisation (Licence Apache 2.0) | Oui | Payant |
| RBAC & rôles multi-actifs | Oui | Partiel |
| Déploiement en minutes, pas en mois | Oui | — |

---

## **🚀 Cas d'Usage**

- **Commercial** : *« Quel est mon panier moyen par région ? »* — réponse sourcée : chiffres par région, évolutions, segment moteur.
- **Support** : *« Quels sont les tickets récurrents ce mois-ci ? »* — clusters détectés (livraison, authentification, retour produit) et évolutions.
- **Direction** : *« Résume-moi les tendances de mon marché. »* — synthèse stratégique : dynamiques du marché et mouvements concurrents.
- **Développeur** : *« Comment puis-je contribuer au projet ? »* — forkez le dépôt, créez une branche, soumettez une PR. Tous les contributeurs sont les bienvenus.

---

## **🔗 Liens & Ressources**

- **GitHub** : https://github.com/ParusDB/parusdb (dépôt public, licence Apache 2.0)
- **Ressources** : Documentation, Guides, Changelog (en construction)
- **Communauté** : Contribuer, GitHub Discussions, Contacter
- **Projet** : À propos, Mentions légales