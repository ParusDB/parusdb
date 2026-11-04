# Politique de sécurité

## Versions supportées

Le projet est publié au fil des releases GitHub. Seule la dernière release
(`vX.Y.Z`) reçoit des correctifs de sécurité.

| Version | Supportée |
|---|---|
| dernière release | Oui |
| versions antérieures | Non |

## Signaler une vulnérabilité

**Ne ouvrez pas d'issue publique** pour une vulnérabilité de sécurité.

- Utilisez l'outil **« Report a vulnerability »** (Private Vulnerability
  Reporting) de ce dépôt GitHub — c'est le canal privilégié ;
- ou envoyez un email au mainteneur : `gbalthazar@parusdb.com`.

Merci d'inclure : une description du problème, l'étape de reproduction, les
versions concernées et, si possible, une preuve de concept. Vous recevrez un
accusé de réception sous 7 jours. Le correctif, s'il est validé, paraîtra dans
une release patch aussi vite que possible, avec un crédit au rapporteur sauf
demande contraire.

## Périmètre

Sont considérés comme vulnérabilités de sécurité les problèmes touchant, par
exemple : l'authentification et la gestion des sessions, le RBAC (rôles,
grants, RLS PostgreSQL), le durcissement Trino (HTTPS, mots de passe, access
control), le chiffrement des credentials au repos, l'exposition de secrets,
ou l'isolation inter-utilisateurs.

Ne sont pas dans le périmètre : les demandes de fonctionnalités, les
questions d'installation ou de configuration (ouvrez une issue classique), et
les vulnérabilités des dépendances tierces déjà corrigées dans une version
disponible (utilisez Dependabot / les advisories).

## Bonnes pratiques de déploiement

ParusDB expose des services réseau (interface Next.js, stack Supabase, Trino
HTTPS). En production :

- placez l'interface derrière un reverse proxy TLS ;
- changez tous les secrets générés par `setup.sh` ;
- ne publiez pas les ports des services internes (Postgres, RustFS, Polaris,
  Ollama) au-delà de votre réseau de confiance.
