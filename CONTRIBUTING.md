# Contribuer à ParusDB

Merci de votre intérêt pour ParusDB. Ce document décrit comment proposer une
contribution. Le projet est maintenu par un mainteneur unique, qui relit et
valide personnellement toutes les pull requests.

## Prérequis

- Git, Node.js LTS + npm, Docker avec le plugin Compose ;
- pour le moteur LLM local (`apps/ollama`) : NVIDIA Container Toolkit
  (runtime `nvidia`) — voir `apps/ollama/README.md` ;
- lire [`AGENTS.md`](AGENTS.md) en entier : conventions de code, règles
  transversales, charte graphique et definition of done. Ce fichier s'applique
  à tout contributeur, humain ou agent IA.

## Installation depuis un clone

```bash
git clone https://github.com/ParusDB/parusdb.git
cd parusdb
sh setup.sh          # orchestre toute la stack (ordre des dépendances)
```

Le pas-à-pas par brique est détaillé dans le [README](README.md)
(démarrage rapide). Pour la validation e2e du Chat IA :
`cd apps/ollama && sh run.sh test`. Pour le moteur ELT :
`cd apps/dlt && sh run.sh verify`.

## Workflow de contribution

1. Forkez le dépôt, puis créez votre branche depuis la branche de
   développement :
   `feat/<brique>-<sujet>` (ex. `feat/lakehouse-explorateur`),
   `fix/<sujet>` ou `docs/<sujet>`.
2. Développez en suivant les conventions du [`AGENTS.md`](AGENTS.md) :
   - TypeScript strict, pas de `any`, frontières typées ;
   - diff minimal : ne pas toucher ce qui n'est pas demandé ;
   - UI en français, identifiants de code en anglais ;
   - pas d'emoji dans l'UI, icônes `lucide-react` uniquement ;
   - toute modification DDL passe par un fichier SQL versionné et
     idempotent, vérifiée par une requête de test.
3. Vérifiez avant de pousser, dans `apps/nextjs` :
   ```bash
   npm run lint
   npm run typecheck
   npm run build
   ```
   Ces trois commandes doivent passer — la CI les exécute sur chaque PR.
4. Ouvrez une Pull Request vers la branche de développement. Décrivez le
   **quoi** et le **pourquoi**, référencez la section de spec fonctionnelle
   concernée, listez les vérifications effectuées et signalez tout écart
   assumé à la documentation.
5. Le mainteneur relit, commente et fusionne. Toutes les validations finales
   sont de sa responsabilité : une PR peut être refusée ou remaniée sans
   préjuger de la qualité du travail.

## Convention de commits

Conventional Commits, description en français à l'impératif :
`feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`.
Exemple : `feat: création des catalogues du lakehouse`.

## Où commencer

- les issues labellisées [`good first issue`](https://github.com/ParusDB/parusdb/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
  sont conçues pour une première contribution ;
- les questions et discussions générales vont dans
  [GitHub Discussions](https://github.com/ParusDB/parusdb/discussions) ;
- les bugs dans les [Issues](https://github.com/ParusDB/parusdb/issues), via
  le template dédié.

## Licence

En soumettant une contribution, vous acceptez qu'elle soit publiée sous
[licence Apache 2.0](LICENSE), sans exigence de CLA. Soumettez uniquement du
travail original dont vous détenez les droits.
