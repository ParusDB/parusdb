## Résumé

<!-- Quoi et pourquoi, en quelques phrases. Référencez l'issue liée si applicable (`Fixes #…`). -->

## Section de spec concernée

<!-- docs/functional/functional_specifications.md — section concernée, ou « hors spec » avec justification. -->

## Vérifications effectuées

- [ ] `npm run lint` passe dans `apps/nextjs`
- [ ] `npm run typecheck` passe dans `apps/nextjs`
- [ ] `npm test` (Vitest) passe dans `apps/nextjs`
- [ ] `npm run build` passe dans `apps/nextjs`
- [ ] `pytest tests` passe dans `apps/dlt` (si le runner est touché)
- [ ] Le SQL éventuel est versionné, idempotent et vérifié par une requête de test
- [ ] Les écrans éventuels respectent la charte (checklist `docs/functional/brand_guidelines.md` §14)
- [ ] Les messages d'erreur sont en français, factuels et actionnables

<!-- Détail complet des vérifications : docs/technical/CI.md. -->

## Écarts assumés

<!-- Tout écart aux docs (spec, charte, AGENTS.md), signalé explicitement — sinon laisser vide. -->
