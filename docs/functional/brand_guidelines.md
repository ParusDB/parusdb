# ParusDB — Charte Graphique (Brand Guidelines)

> **Objectif de ce document** : servir de référence unique et complète pour répliquer l'identité
visuelle de ParusDB sur l'application SaaS. Il est écrit pour être consommé par un agent de code
ou un développeur humain. Tout ce qui est marqué « à copier tel quel » doit être copié sans
adaptation.
> 
> 
> **Stack cible de l'application** : Next.js (App Router) + TypeScript + Tailwind CSS v4 +
> shadcn/ui + Supabase.
> 
> **Source de vérité** : le dépôt de la landing page. Les valeurs proviennent de `src/styles.css`,
> `src/routes/index.tsx` et `src/routes/__root.tsx`.
> 

---

## Sommaire

1. Identité de marque
2. Palette de couleurs
3. Tokens CSS complets (à copier tel quel)
4. Typographie
5. Rayons, espacements et layout
6. Motifs et textures
7. Effets d'interaction (hover, focus, ombres)
8. Composants — conventions
9. Intégration Next.js (setup exact)
10. Icônes
11. Logos et assets
12. Ton éditorial
13. Do / Don't
14. Checklist de conformité

---

## 1. Identité de marque

**ParusDB** est une plateforme Data Analytique « IAgentique First », open source (licence
Apache 2.0) et souveraine (auto-hébergement, BYO LLM/S3/cloud, RGPD).

La charte s'appelle **« Mésange Charbonnière »** — l'oiseau (mascotte visible sur le hero) qui
donne son nom au produit (*Parus major*). Elle inspire la palette : un contraste fort
**charbon/jaune vif**, précis et lisible, sans gradient criard ni bleu SaaS générique.

Valeurs à refléter visuellement :

- **Contraste assumé** : blocs charbon profonds sur fond blanc cassé, accents jaune vif.
- **Précision technique** : détails fins (bordures à 10 % d'opacité, mono pour les labels
techniques, grille en arrière-plan).
- **Open source / franchise** : pas d'artifice, pas d'illustration 3D générique, du texte direct
et des composants nets.
- **Énergie** : micro-interactions de soulèvement (`hover:-translate-y-*`), jaune utilisé avec
parcimonie pour les actions et les moments forts.

Le jaune est **la couleur signature**. Si l'utilisateur ne retient qu'une chose de l'interface, ce
doit être « la plateforme au jaune vif sur charbon ».

---

## 2. Palette de couleurs

### 2.1 Palette brute (6 couleurs)

| Token | Hex | Usage principal |
| --- | --- | --- |
| `charbon` | `#1A1A1A` | Fond des sections sombres, texte principal, boutons inversés |
| `cendre` | `#3A3A3A` | Texte secondaire (muted-foreground), nuances de gris |
| `jaune` | `#FFD700` | **Couleur signature.** Primary, CTA, accents, focus ring, sélection |
| `blanc` | `#F5F5F5` | Fond global (blanc cassé), texte sur fond charbon |
| `olive` | `#6B8E23` | Couleur d'accent secondaire (eyebrows sur fond clair, icônes) |
| `bleu` | `#2E86C1` | Couleur data (icônes, badges, graphiques) |

Couleur utilitaire supplémentaire : `destructive` = `#B23A48` (rouge framboise sombre, PAS un rouge
pur `#EF4444`).

### 2.2 Règles de répartition

- **≈ 60 %** fonds neutres (blanc cassé `#F5F5F5` / cartes blanches `#FFFFFF` / charbon pour les
sections sombres), **≈ 30 %** texte et structure (charbon, cendre, bordures), **≤ 10 %** jaune.
- Le jaune est réservé aux **CTA, actions primaires, focus, sélection, accents sur fond charbon**.
Ne jamais l'utiliser comme fond de page ni comme texte sur fond clair (contraste insuffisant).
- Sur fond jaune, le texte est toujours `charbon` — jamais blanc.
- L'olive et le bleu sont des couleurs de **catégorisation/accents secondaires** (icônes, tags),
pas des couleurs d'action.
- Alternance des sections : fond clair (`bg-background`) ↔ fond charbon (`bg-charbon text-blanc`)
pour créer le rythme visuel.

### 2.3 Thème clair (défaut)

| Rôle sémantique | Valeur |
| --- | --- |
| `background` | `#F5F5F5` (blanc cassé) |
| `foreground` | `#1A1A1A` (charbon) |
| `card` / `popover` | `#FFFFFF` |
| `primary` | `#FFD700` (jaune) |
| `primary-foreground` | `#1A1A1A` |
| `secondary` | `#1A1A1A` (bouton inversé) |
| `secondary-foreground` | `#F5F5F5` |
| `muted` | `#ECECEC` |
| `muted-foreground` | `#3A3A3A` (cendre) |
| `accent` | `#6B8E23` (olive) |
| `accent-foreground` | `#F5F5F5` |
| `destructive` | `#B23A48` |
| `border` | `rgba(26,26,26,0.1)` |
| `input` | `rgba(26,26,26,0.14)` |
| `ring` | `#FFD700` (focus = jaune) |

### 2.4 Thème sombre

| Rôle sémantique | Valeur |
| --- | --- |
| `background` | `#0F0F0F` |
| `foreground` | `#F5F5F5` |
| `card` / `popover` | `#1A1A1A` |
| `primary` | `#FFD700` (inchangé) |
| `primary-foreground` | `#1A1A1A` |
| `secondary` | `#2A2A2A` |
| `muted` | `#2A2A2A` |
| `muted-foreground` | `#A8A8A8` |
| `accent` | `#6B8E23` (inchangé) |
| `border` | `rgba(245,245,245,0.1)` |
| `input` | `rgba(245,245,245,0.14)` |

À noter : le jaune et l'olive **ne changent pas** entre les deux thèmes — c'est le charbon qui
s'inverse.

### 2.5 Dégradés et ombres de marque

```css
/* Dégradés (définis comme variables) */
--gradient-yolk: linear-gradient(135deg, #ffd700 0%, #ffb800 100%); /* boutons premium jaune */
--gradient-ink: linear-gradient(180deg, #1a1a1a 0%, #0a0a0a 100%);  /* sections charbon profond */

/* Ombres de marque */
--shadow-yolk: 0 20px 60px -20px rgba(255, 215, 0, 0.45); /* halo jaune sous les CTA */
--shadow-elev: 0 24px 60px -30px rgba(26, 26, 26, 0.35);  /* élévation des cartes */
```

---

## 3. Tokens CSS complets (à copier tel quel)

C'est le fichier `globals.css` (ou `app/globals.css`) de l'application Next.js, adapté de
`src/styles.css`. Tailwind CSS v4 — **pas de `tailwind.config.ts`**, tout vit dans le CSS.

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

/* =========================================================
   ParusDB — Charte "Mésange Charbonnière"
   Palette officielle :
   - Charbon      #1A1A1A
   - Cendre       #3A3A3A
   - Jaune vif    #FFD700
   - Blanc cassé  #F5F5F5
   - Vert olive   #6B8E23
   - Bleu data    #2E86C1
========================================================= */

@theme inline {
  /* Polices : variables posées par next/font (voir section 9) */
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --font-display: var(--font-space-grotesk), "Inter", sans-serif;
  --font-mono: var(--font-jetbrains-mono), ui-monospace, monospace;

  /* Rayons (base 12px) */
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --radius-2xl: calc(var(--radius) + 8px);

  /* Couleurs de marque -> classes utilitaires bg-charbon, text-jaune, etc. */
  --color-charbon: var(--charbon);
  --color-cendre: var(--cendre);
  --color-jaune: var(--jaune);
  --color-blanc: var(--blanc);
  --color-olive: var(--olive);
  --color-bleu: var(--bleu);

  /* Alias sémantiques shadcn/ui */
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
}

:root {
  --radius: 0.75rem;

  --charbon: #1a1a1a;
  --cendre: #3a3a3a;
  --jaune: #ffd700;
  --blanc: #f5f5f5;
  --olive: #6b8e23;
  --bleu: #2e86c1;

  --background: #f5f5f5;
  --foreground: #1a1a1a;
  --card: #ffffff;
  --card-foreground: #1a1a1a;
  --popover: #ffffff;
  --popover-foreground: #1a1a1a;
  --primary: #ffd700;
  --primary-foreground: #1a1a1a;
  --secondary: #1a1a1a;
  --secondary-foreground: #f5f5f5;
  --muted: #ececec;
  --muted-foreground: #3a3a3a;
  --accent: #6b8e23;
  --accent-foreground: #f5f5f5;
  --destructive: #b23a48;
  --destructive-foreground: #f5f5f5;
  --border: rgba(26, 26, 26, 0.1);
  --input: rgba(26, 26, 26, 0.14);
  --ring: #ffd700;

  --gradient-yolk: linear-gradient(135deg, #ffd700 0%, #ffb800 100%);
  --gradient-ink: linear-gradient(180deg, #1a1a1a 0%, #0a0a0a 100%);
  --shadow-yolk: 0 20px 60px -20px rgba(255, 215, 0, 0.45);
  --shadow-elev: 0 24px 60px -30px rgba(26, 26, 26, 0.35);
}

.dark {
  --background: #0f0f0f;
  --foreground: #f5f5f5;
  --card: #1a1a1a;
  --card-foreground: #f5f5f5;
  --popover: #1a1a1a;
  --popover-foreground: #f5f5f5;
  --primary: #ffd700;
  --primary-foreground: #1a1a1a;
  --secondary: #2a2a2a;
  --secondary-foreground: #f5f5f5;
  --muted: #2a2a2a;
  --muted-foreground: #a8a8a8;
  --accent: #6b8e23;
  --accent-foreground: #f5f5f5;
  --border: rgba(245, 245, 245, 0.1);
  --input: rgba(245, 245, 245, 0.14);
}

@layer base {
  * {
    border-color: var(--color-border);
  }
  html {
    scroll-behavior: smooth;
  }
  body {
    background-color: var(--color-background);
    color: var(--color-foreground);
    font-family: var(--font-sans);
    font-feature-settings: "ss01", "cv11";
    -webkit-font-smoothing: antialiased;
  }
  h1,
  h2,
  h3,
  h4 {
    font-family: var(--font-display);
    letter-spacing: -0.02em;
    font-weight: 600;
  }
  code,
  pre,
  .mono {
    font-family: var(--font-mono);
  }
  ::selection {
    background: var(--jaune);
    color: var(--charbon);
  }
}

@utility yolk-stripe {
  background-image: repeating-linear-gradient(135deg, var(--jaune) 0 10px, transparent 10px 20px);
}

@utility grid-bg {
  background-image:
    linear-gradient(rgba(245, 245, 245, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(245, 245, 245, 0.06) 1px, transparent 1px);
  background-size: 48px 48px;
}

@utility text-balance {
  text-wrap: balance;
}
```

> **Différence avec la landing** : l'original utilise `@import "tailwindcss" source(none)` et
`@source "../src"` (spécifique au bundler Vite de TanStack Start). En Next.js, on importe
simplement `tailwindcss` et il détecte les sources automatiquement. Tout le reste est identique.
> 

---

## 4. Typographie

### 4.1 Familles

| Rôle | Police | Graisses chargées | Usage |
| --- | --- | --- | --- |
| **Sans (corps)** | Inter | 400, 500, 600, 700 | Texte courant, UI, formulaires |
| **Display (titres)** | Space Grotesk | 500, 600, 700 | Tous les `h1`–`h4`, titres de cartes, chiffres |
| **Mono** | JetBrains Mono | 400, 500 | Code, labels techniques, « eyebrows », tags, numéros |

### 4.2 Hiérarchie (classes Tailwind)

Tous les titres (`h1`–`h4`) sont automatiquement en Space Grotesk 600 avec
`letter-spacing: -0.02em` (posé dans `@layer base`, section 3).

| Élément | Classes |
| --- | --- |
| H1 (hero) | `font-display text-5xl leading-[1.05] sm:text-6xl lg:text-7xl` |
| H1 CTA final | `font-display text-5xl leading-tight sm:text-6xl` |
| H2 (section) | `font-display text-4xl sm:text-5xl text-balance` |
| H3 (carte) | `font-display text-xl` à `text-2xl` |
| H4 | `font-display text-lg` |
| Paragraphe lead | `mt-6 text-lg leading-relaxed` (+ `text-blanc/70` sur charbon) |
| Paragraphe standard | `text-sm` ou `text-base` `text-muted-foreground` |
| **Eyebrow** (label au-dessus des titres) | `mono text-xs uppercase tracking-[0.2em] text-olive` (fond clair) ou `text-jaune` (fond charbon) |
| Code | `mono text-sm` dans `<pre>` sur `bg-muted` ou fond charbon |

L'eyebrow mono en capitales avec `tracking-[0.2em]` est un **marqueur de marque fort** — présent
au-dessus de chaque section sur la landing (« Le problème », « Cas d'usage », « FAQ », etc.). À
réutiliser systématiquement dans l'app pour titrer les sections de page.

`text-balance` (`text-wrap: balance`) est appliqué sur les grands titres pour éviter les lignes
orphelines.

### 4.3 Règles typographiques

- Corps en Inter, jamais en Space Grotesk ; Space Grotesk uniquement pour les titres.
- Le mono n'est pas réservé au code : il sert pour les **labels techniques, tags, numéros d'étapes
("01"), mentions discretes** (« Fait en France »), enchainant la fibre « data/terminal ».
- Ne pas charger de graisses non listées (pas de Inter 300 ni de Space Grotesk 400).
- Graisse par défaut du texte : `400` ; boutons et liens actifs : `500`–`600`.

---

## 5. Rayons, espacements et layout

### 5.1 Rayons

- **Base** : `-radius: 0.75rem` (12px) → rayons dérivés `sm/md/lg/xl/2xl`.
- **Cartes** : `rounded-3xl` (24px) — c'est LE rayon identifiable des blocs de contenu.
- **Boutons** : `rounded-full` (pilule) sur la landing ; dans l'app, les boutons shadcn gardent
`rounded-md` pour la densité, sauf les CTA marketing qui restent pilules.
- **Éléments internes** (chips icônes, blocs de code, bulles de chat) : `rounded-lg` / `rounded-xl`
/ `rounded-2xl`.
- Ne pas utiliser de rayons supérieurs à `3xl` ni de cards carrées.

### 5.2 Layout

- Conteneur de page : `mx-auto max-w-7xl px-6`.
- Sections : `py-24` (96px), séparées par `border-b border-border`.
- Grilles : `grid-cols-1` mobile → `md:grid-cols-2` → `lg:grid-cols-4` (ou grille 12 colonnes
`lg:grid-cols-12` avec `lg:col-span-*` pour les compositions asymétriques).
- Gap standard entre cartes : `gap-6` (ou `gap-8` pour les sections aérées).
- Hauteur navbar : `h-16`, sticky, `bg-background/80 backdrop-blur-xl`,
`border-b border-border/70`.

### 5.3 Espacements récurrents

- Padding carte : `p-6` à `p-8` (`p-7` sur cartes compactes).
- Marge titres → contenu : `mt-2.5` (desc), `mt-6` (paragraphe), `mt-14`/`mt-16` (grille).
- Espace icône → titre : `mb-4`/`mb-5`.

---

## 6. Motifs et textures

Deux utilitaires de marque (déjà dans le CSS de la section 3) et un motif inline :

| Motif | Utilitaire / code | Usage |
| --- | --- | --- |
| **Grille de fond** | `grid-bg` (maille 48px, lignes blanches 6 % d'opacité) + `opacity-40` | Arrière-plan des sections charbon (hero, « comment ça marche ») |
| **Halo jaune** | div absolute `h-[600px] w-[600px] rounded-full blur-3xl opacity-30` avec `background: radial-gradient(circle, #FFD700 0%, transparent 60%)` | Coin supérieur du hero charbon — signature visuelle |
| **Rayures jaunes** (CTA final) | inline `repeating-linear-gradient(45deg, #1A1A1A 0 2px, transparent 2px 20px)` sous `opacity-10` | Section CTA `bg-jaune` : fines diagonales charbon |

Le trio **charbon + grille + halo jaune** est la combinaison de fond la plus reconnaissable de la
marque. À réutiliser sur l'écran de login de l'app, les états vides (« empty states ») et les pages
de chargement.

---

## 7. Effets d'interaction (hover, focus, ombres)

- **Soulèvement** : les cartes et boutons importants se soulègent au survol :
`transition-transform hover:-translate-y-0.5` (boutons) ou
`transition-all hover:-translate-y-1` (cartes, avec `hover:border-charbon` sur fond clair).
- **Ombres** (valeurs littérales utilisées sur la landing, à réutiliser telles quelles) :
    - CTA jaune : `shadow-[0_20px_60px_-20px_rgba(255,215,0,0.5)]`
    - Carte au survol : `shadow-[0_24px_60px_-30px_rgba(26,26,26,0.35)]`
    - Carte charbon : `shadow-[0_30px_60px_-20px_rgba(26,26,26,0.5)]`
    - Image hero : `shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]`
- **Focus** : `-ring: #FFD700` — le focus est **jaune**, partout. Ne jamais le rendre bleu.
- **Sélection de texte** : fond jaune, texte charbon (`::selection` déjà posé en base).
- **Lien actif au footer** : `hover:text-jaune`.
- **Flèches animées** : icône flèche dans les boutons → `group-hover:translate-x-0.5`.
- **Soulignement qui grandit** (étapes) : `h-px w-8 bg-jaune group-hover:w-16`.
- Durées de transition : défauts Tailwind (`150ms`/`300ms`), jamais de bounces ni d'elastic.
- Animations d'entrée : discrètes, fade/slide via `tw-animate-css` si besoin.

---

## 8. Composants — conventions

### 8.1 Configuration shadcn/ui

`components.json` (style « new-york », le CSS de la section 3 fournit les variables) :

```json
{
  "$schema": "<https://ui.shadcn.com/schema.json>",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "css": "app/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

Le mapping sémantique fait que les composants shadcn « tombent juste » automatiquement :
`Button` default = jaune/charbon, `Card` = blanc + bordures fines, `Alert` destructive = framboise,
etc.

### 8.2 Patterns de composants maison (référence extraite de la landing)

**Carte de contenu** (pattern le plus récurrent) :

```tsx
<div className="rounded-3xl border border-border bg-card p-8 transition-all hover:-translate-y-1 hover:border-charbon hover:shadow-[0_24px_60px_-30px_rgba(26,26,26,0.35)]">
  <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-jaune text-charbon">
    <Icon className="h-6 w-6" />
  </div>
  <h3 className="font-display text-2xl">{title}</h3>
  <p className="mt-2.5 text-muted-foreground">{desc}</p>
</div>
```

**Chip icône — 4 accents de marque** (pour colorer par type de contenu) :

```tsx
const accentMap = {
  jaune: "bg-jaune text-charbon",
  olive: "bg-olive text-blanc",
  bleu: "bg-bleu text-blanc",
  cendre: "bg-charbon text-jaune", // inversé : charbon + texte jaune
};
// Taille standard : h-10 w-10 rounded-lg (icône h-5 w-5) ou h-12 w-12 rounded-xl (h-6 w-6)
```

**Badge / tag** :

```tsx
<span className="mono inline-flex w-fit rounded-full bg-jaune px-3 py-1 text-[11px] tracking-wider text-charbon">
  {tag.toUpperCase()}
</span>
// Variantes : bg-olive text-blanc, bg-bleu text-blanc, bg-charbon text-jaune
```

**Boutons CTA** (pages marketing / auth de l'app) :

```tsx
// Primaire — pilule jaune, halo
<a className="group inline-flex items-center gap-2 rounded-full bg-jaune px-6 py-3.5 text-sm font-semibold text-charbon shadow-[0_20px_60px_-20px_rgba(255,215,0,0.5)] transition-transform hover:-translate-y-0.5">
  Label <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
</a>

// Secondaire — pilule charbon (sur fond clair) ou bordure sur charbon (voir 8.3)
<a className="inline-flex items-center gap-2 rounded-full bg-charbon px-4 py-2 text-sm font-medium text-blanc transition-transform hover:-translate-y-0.5">
  Label
</a>

// Ghost — bordure 2px inversée au survol
<a className="inline-flex items-center gap-2 rounded-full border-2 border-charbon px-7 py-4 text-sm font-semibold text-charbon transition-colors hover:bg-charbon hover:text-blanc">
  Label
</a>
```

**Sur fond charbon** : bouton primaire = `bg-jaune text-charbon` ; bouton secondaire =
`border border-white/20 text-blanc/90 hover:bg-white/5` ; listes à cocher = `Icon.Check`
en `text-jaune`.

**Bulles de chat IA** (pour l'interface conversationnelle du SaaS) :

```tsx
// Question utilisateur
<div className="rounded-lg rounded-tr-none bg-muted px-3 py-2 text-sm">…</div>
// Réponse agent : fond charbon, code SQL en jaune
<div className="rounded-lg rounded-tl-none bg-charbon px-3 py-2 text-blanc">
  <span className="mono text-jaune">SELECT region, AVG(cart)</span> · …
</div>
```

**Réponses agent en markdown** (chat) : le contenu de l'agent est rendu en markdown complet —
titres en `font-display` à taille contenue dans une bulle (`text-lg` max), listes à puces,
gras, code inline `mono` jaune sur `bg-white/10`, tableaux à filets `white/10`, citations à
filet jaune. Les blocs de code passent à la ligne automatiquement (`whitespace-pre-wrap
break-words`) : jamais de défilement horizontal dans une bulle. Chaque bloc porte le label du
langage et un bouton « Copier ».

**Coloration syntaxique** (blocs de code du chat, fond charbon) : palette highlight.js,
définie dans `globals.css` (classes `.hljs-*`) — jamais de hex en dur dans les composants :

```tsx
<div className="overflow-hidden rounded-lg border border-white/10 bg-black/40">
  <span className="mono text-[10px] uppercase tracking-[0.2em] text-blanc/50">python</span>
  <code className="mono block whitespace-pre-wrap break-words text-sm leading-relaxed">…</code>
</div>
```

| Élément | Couleur |
|---|---|
| Mots-clés, littéraux | `#C678DD` |
| Chaînes de caractères | `#98C379` |
| Nombres, métadonnées | `#D19A66` |
| Fonctions, titres | `#61AFEF` |
| Classes, types, built-ins | jaune `#FFD700` |
| Attributs, variables | `#E06C75` |
| Commentaires | `#8B9199` italique |
| Code sans langage identifié | jaune mono (défaut charte) |

**Bloc terminal / code** :

```tsx
<pre className="overflow-x-auto rounded-lg bg-muted p-4">
  <code className="mono text-sm leading-relaxed">…</code>
</pre>
// Label au-dessus : icône Terminal en text-olive + <span className="mono text-sm text-muted-foreground">Terminal</span>
```

**FAQ / accordion** : conteneur `rounded-3xl border border-border bg-card divide-y divide-border`,
items `px-6 py-5`, titre `font-display text-lg`, chevron dans une pastille
`h-8 w-8 rounded-full border border-border` qui pivote à l'ouverture
(`group-open:rotate-45`).

**Étapes numérotées** : conteneur en grille `gap-px bg-white/10 border border-white/10` sur fond
charbon (le gap crée les filets), numéro `mono text-sm text-jaune` (« 01 »…04), chaque cellule
`bg-charbon p-8 hover:bg-[#141414]`.

**Toast / notifications** : composant sonner shadcn, accent jaune pour succès (jamais vert Tailwind
par défaut — l'olive peut servir de « succès secondaire »), `#B23A48` pour erreur.

### 8.3 Adaptation au contexte SaaS

La landing est marketing ; l'app est un outil de travail dense. Règles de traduction :

| Landing | Application SaaS |
| --- | --- |
| CTA pilules `rounded-full` | Boutons shadcn `rounded-md` dans les toolbars/tables ; pilules uniquement sur les écrans auth/onboarding/settings marketing |
| Cartes `rounded-3xl p-8` | Mêmes tokens mais `p-6` max dans les panneaux |
| Sections alternées clair/charbon | Fond `background` neutre partout ; le charbon reste pour sidebar, écrans auth, empty states |
| Hover `-translate-y-1` | À conserver sur cartes/résultats ; à désactiver dans les tables de données (drag/drop, sélection) |
| Ombres de marque | À conserver sur les modaux et dropdowns (`shadow-elev`) |

**Sidebar** : fond `charbon` (ou `card` en clair), texte `blanc/70` → `hover:text-jaune` sur les
items actifs, logo officiel plein cadre en tête (bandeau blanc, bouton accueil), `w-64`.

---

## 9. Intégration Next.js (setup exact)

### 9.1 Polices avec `next/font/local` (auto-hébergées)

Les trois polices sont **auto-hébergées** : fichiers variables woff2 dans
`apps/nextjs/app/fonts/` (licences SIL OFL 1.1, documentées dans
`app/fonts/README.md` et le `NOTICE` du dépôt). Le build **n'interroge jamais
Google Fonts** — y compris en CI : l'échec de téléchargement sur un runner
faisait échouer Turbopack en « `next/font/google queries have exactly one
entry` », message trompeur. Ne pas revenir à `next/font/google`.

Les polices variables couvrent les graisses de la section 4.1 (Inter 100–900,
Space Grotesk 300–700, JetBrains Mono 100–800) — le CSS n'utilise que les
graisses de la charte.

```tsx
// app/layout.tsx
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({
  src: "./fonts/inter-var.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = localFont({
  src: "./fonts/space-grotesk-var.woff2",
  weight: "300 700",
  variable: "--font-space-grotesk",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-var.woff2",
  weight: "100 800",
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://parusdb.com"),
  title: "ParusDB — Plateforme Data Analytique IAgentique Open Source",
  description:
    "ParusDB unifie ELT, Data Lakehouse et agents IA dans une plateforme open source et souveraine. Licence Apache 2.0.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-background font-sans text-foreground antialiased">{children}</body>
    </html>
  );
}
```

> Les variables `--font-inter`, `--font-space-grotesk`, `--font-jetbrains-mono` sont consommées par
`--font-sans` / `--font-display` / `--font-mono` dans `globals.css` (section 3). Ne pas changer
ces noms de variables.
> 

### 9.2 Dépendances minimales

```bash
pnpm add tailwindcss @tailwindcss/postcss tw-animate-css
pnpm dlx shadcn@latest init   # style new-york, baseColor slate, cssVariables true
```

### 9.3 Dark mode

Le dark mode est piloté par la classe `.dark` sur `<html>` (`@custom-variant dark (&:is(.dark *))`).
Utiliser `next-themes` :

```tsx
<ThemeProvider attribute="class" defaultTheme="light" enableSystem>
```

Les composants shadcn héritent automatiquement. Les couleurs de marque (`jaune`, `olive`) ne
changent pas de thème — seuls les fonds/textes s'inversent (voir 2.4).

### 9.4 Supabase

Aucune implication visuelle directe. Veiller simplement à ce que les écrans liés à l'auth
(login, reset, callback) soient habillés selon la section 6 (fond charbon + grille + halo jaune)
avec le pattern boutons 8.2 — c'est le premier contact des utilisateurs avec l'app.

---

## 10. Icônes

- Bibliothèque : **lucide-react** (config shadcn). Sur la landing, les icônes sont même dessinées à
la main dans le même style line — lucide est l'équivalent standard.
- Style : **outline / stroke fin** — `strokeWidth: 1.6` pour les icônes de contenu,
`1.8` pour flèches/terminal/code, `2` uniquement pour les checks.
- Tailles standard : `h-4 w-4` (inline bouton), `h-5 w-5` (chips h-10), `h-6 w-6` (chips h-12).
- Toujours `stroke="currentColor"` pour hériter de la couleur du conteneur.
- Couleur d'icône : dans une chip, définie par l'accent (`text-charbon`, `text-blanc`…) ; icône
isolée sur fond clair → `text-olive` (terminal) ou `text-jaune` (sur charbon).
- Pas d'icônes emoji, pas d'icônes remplies (sauf le point lumineux
`<span className="h-1.5 w-1.5 rounded-full bg-jaune shadow-[0_0_10px_#FFD700]" />` —
le « feu jaune » des badges de statut).

---

## 11. Logos et assets

Assets applicatifs (dans `apps/nextjs/`) :

| Fichier | Usage |
| --- | --- |
| `public/parusdb-logo.jpg` | Logo officiel — JPEG à fond blanc (1340×423), asset d'origine jamais retouché par le code |
| `app/favicon.ico` | Favicon de l'application (convention Next.js des metadata files) |

Une variante transparente (artwork clair, fond PNG alpha) pourra être ajoutée si un
thème sombre exige un second rendu du logo ; elle n'existe pas à ce jour dans le dépôt.

Assets de la landing (hors dépôt de l'application) : `logo-parusdb-avec-nom-sans-fond.png`,
`logo-parusdb-banniere-transparent.png`, `logo-github-transparent.png`,
`logo-github-fond-noir.jpg`, `mesange-hero.jpg`.

Règles :

- **Emplacement unique** : en tête du menu latéral, plein cadre — le blanc du JPEG
  couvre tout le haut de la colonne, coins supérieurs alignés sur ceux de la sidebar.
  Le logo est le bouton « Accueil » (retour au Chat). Jamais dans les états vides,
  les écrans d'authentification ni le contenu principal.
- **Décision assumée** : le JPEG à fond blanc s'affiche en bandeau plein cadre sur le
  charbon de la sidebar (la version transparente a été testée puis écartée). Ne jamais
  recolorer ni déformer le logo.
- En barre supérieure mobile : hauteur `h-10`.
- Le titre SEO de référence : « ParusDB - Plateforme Data Analytique IAgentique Open Source ».

---

## 12. Ton éditorial

- **Langue** : français (produit français, « Fait en France »). UI en français, code/identifiants
techniques en anglais.
- Voix : **direct, technique, confiant, sans jargon marketing**. Phrases courtes. Le produit parle
à des data engineers ET à des métiers.
- Signature du ton — exemples réels à imiter :
    - « Vos données, enfin parlantes. »
    - « Parlez à vos données. Elles vous répondront. »
    - « Gratuit. Pour de vrai. »
    - « Déployez-la vous-même, contribuez, ou utilisez-la gratuitement. »
    - « Assembler une Modern Data Stack, c'est long, cher, fragile. »
- Dans l'UI : boutons à l'impératif (« Connecter une source », « Créer un agent »), erreurs
factuelles et actionnables (« La connexion a échoué : clé API invalide »), jamais de « Oups ! ».
- Mise en exergue : `<b>` pour les mots clés dans un paragraphe (`text-blanc` sur fond charbon,
`text-foreground` sur fond clair).
- Ponctuation : apostrophes typographiques françaises ; espaces insécables avant `: ; ! ?`.

---

## 13. Do / Don't

| Fait | À ne pas faire |
| --- | --- |
| Jaune `#FFD700` pour les CTA, focus, sélection, accents | Utiliser le jaune comme texte sur fond clair ou comme fond de page |
| Bordures fines `rgba(26,26,26,0.1)` — la structure est discrète | Bordures pleines opaques, ombres dures, outlines |
| `rounded-3xl` pour les cartes, pilules pour les CTA marketing | Cards carrées ou `rounded-[2rem]`+ |
| Inter + Space Grotesk + JetBrains Mono uniquement | Introduire une 4e police (Poppins, Montserrat…), System UI comme identité |
| Eyebrows mono `uppercase tracking-[0.2em]` en olive/jaune | Eyebrows en Space Grotesk ou couleur aléatoire |
| Sections charbon avec `grid-bg` + halo jaune radial | Dégradés bleu-violet SaaS génériques |
| Destructive `#B23A48`, succès = jaune/olive | Rouge Tailwind `#ef4444`, vert `#22c55e` par défaut |
| Hover = soulèvement `-translate-y-*` + transition douce | Scale agressif, rotation, animations flashy |
| Cœur de la palette sur token sémantiques (`bg-primary`, `text-muted-foreground`) avec utilitaires de marque en renfort (`bg-jaune`) | Valeurs hex codées en dur dans les composants (sauf les ombres/motifs documentés) |

---

## 14. Checklist de conformité

Avant de considérer un écran « conforme à la marque » :

- [ ]  `globals.css` identique à la section 3 (tokens, base, utilitaires).
- [ ]  Les 3 polices auto-hébergées chargées via `next/font/local` (`app/fonts/`, section 9.1)
       avec les graisses exactes de la section 4.1.
- [ ]  Focus visible jaune (`ring` = `#FFD700`) sur tous les éléments interactifs.
- [ ]  `::selection` jaune/charbon.
- [ ]  Boutons primaires = jaune/charbon ; texte sur jaune toujours charbon.
- [ ]  Cartes = `rounded-3xl`, `bg-card`, bordure 10 %, hover soulèvement + `shadow-elev`.
- [ ]  Eyebrows de section en mono uppercase `tracking-[0.2em]`.
- [ ]  Écrans « moments forts » (login, empty states, onboarding) = charbon + `grid-bg` + halo jaune.
- [ ]  Icônes lucide stroke 1.6–1.8, `currentColor`, tailles standard.
- [ ]  Dark mode : uniquement l'inversion charbon/blanc cassé ; jaune et olive invariants.
- [ ]  Textes en français, ton direct (section 12).
- [ ]  Contraste AA vérifié : jaune interdit comme texte ; sur charbon, texte blanc cassé à
70–80 % d'opacité maximum pour le secondaire.

---

*Charte « Mésange Charbonnière » — ParusDB. Toute évolution de la charte doit d'abord être
appliquée à `src/styles.css` sur la landing, puis reportée dans ce document.*