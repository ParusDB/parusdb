# Polices auto-hébergées

Les polices de la charte « Mésange Charbonnière » (`docs/functional/brand_guidelines.md`
§4) sont servies localement via `next/font/local` : le build n'interroge jamais
Google Fonts, ni le poste de développement ni la CI.

| Fichier | Police | Graisses servies | Licence |
|---|---|---|---|
| `inter-var.woff2` | Inter (corps) | variable 100–900 | SIL OFL 1.1 |
| `space-grotesk-var.woff2` | Space Grotesk (`h1`–`h4`, chiffres) | variable 300–700 | SIL OFL 1.1 |
| `jetbrains-mono-var.woff2` | JetBrains Mono (code, eyebrows, labels) | variable 100–800 | SIL OFL 1.1 |

Fichiers obtenus depuis Google Fonts (fonts.googleapis.com/css2, sous-ensemble
latin, format variable woff2). Les trois polices sont publiées sous licence
SIL Open Font License 1.1 : redistribution autorisée avec la licence —
<https://openfontlicense.org>. Conformément au NOTICE du dépôt, « ParusDB »
n'est pas utilisé comme nom des polices dérivées.
