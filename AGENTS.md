---
# **AGENTS.md**
**Projet** : Développement d'applications Next.js 16+ (App Router) avec Mistral Vibe.
**Dernière mise à jour** : 15 mai 2026
**Standard** : [agents.md](https://agents.md/) – Instructions dédiées aux agents de codage.

---

## **📌 Contexte du Projet**
- **Objectif** : Créer/modifier des applications web modernes avec **Next.js 16+ (App Router)**, en appliquant les **meilleures pratiques 2026** (Server Components, Server Actions, streaming, cache intelligent).
- **Stack par défaut** :
  - Frontend : Next.js 16+, React 18+, TypeScript, **App Router**, Turbopack, Tailwind CSS v4, shadcn/ui.
  - Backend : Server Actions, Next.js API Routes, Supabase (auth/DB), Middleware (Edge).
  - i18n : [next-intl](https://next-intl-docs.vercel.app/) (recommandé pour App Router).
  - Déploiement : Vercel (prioritaire), Docker, ou self-hosting.
- **Design System** : Tokens CSS (HSL), composants réutilisables, `next/image` pour les images.

---

## **🛠️ Environnement de Développement**
### **Prérequis**
- Node.js 20+ (LTS).
- pnpm (recommandé) ou npm/yarn.
- Turbopack (bundler par défaut depuis Next.js 15).

### **Commandes Clés**
| Commande | Description |
|----------|-------------|
| `pnpm dev` | Lance le serveur de développement (Turbopack). |
| `pnpm build` | Build de production (vérifier `next build` sans erreurs). |
| `pnpm lint` | Exécute ESLint + TypeScript (à lancer **avant chaque commit**). |
| `pnpm test` | Lance les tests (Vitest/Jest). |
| `pnpm db:push` | Applique les migrations Supabase (si utilisé). |

> ⚠️ **À exécuter avant chaque PR** :
> ```bash
> pnpm lint && pnpm build && pnpm test
> ```

---

## **🤖 Outils MCP (Model Context Protocol) pour Next.js**
**Documentation** : [Next.js MCP Guide](https://nextjs.org/docs/app/guides/mcp.md)
**Package** : [`next-devtools-mcp`](https://www.npmjs.com/package/next-devtools-mcp) (Next.js 16+ requis).

### **Configuration**
1. Installer le package et configurer `.mcp.json` à la racine du projet :
   ```json
   {
     "mcpServers": {
       "next-devtools": {
         "command": "npx",
         "args": ["-y", "next-devtools-mcp@latest"]
       }
     }
   }
   ```
2. Lancer le serveur de développement Next.js :
   ```bash
   pnpm dev
   ```
3. Ton agent de codage **se connectera automatiquement** à ton instance Next.js via `next-devtools-mcp`.

---

### **Capacités Disponibles**
| Outil | Description | Exemple d'utilisation |
|-------|-------------|-----------------------|
| `get_errors` | Récupère les erreurs de build, runtime et TypeScript. | `"Quelles sont les erreurs actuelles dans mon application ?"` |
| `get_logs` | Récupère les logs du serveur de développement (console, requêtes). | `"Affiche les logs du serveur Next.js."` |
| `get_page_metadata` | Récupère les métadonnées des pages (routes, composants, rendering). | `"Quels sont les composants de la page /dashboard ?"` |
| `get_project_metadata` | Récupère la structure du projet, la configuration et l'URL du serveur. | `"Quelle est la configuration actuelle de mon projet ?"` |
| `get_routes` | Liste toutes les routes (App Router et Pages Router). | `"Quelles sont toutes les routes de mon app ?"` |
| `get_server_action_by_id` | Trouve une Server Action par son ID (fichier et nom de fonction). | `"Où est définie la Server Action pour le formulaire de contact ?"` |

---

### **Cas d'Usage**
- **Détection et diagnostic d'erreurs en temps réel** :
  ```plaintext
  User: "Quelles sont les erreurs actuelles dans mon application ?"
  → L'agent interroge `get_errors` et propose des corrections.
  ```
- **Aide à la migration et aux bonnes pratiques** :
  ```plaintext
  User: "Aide-moi à migrer mon app vers Next.js 16."
  → L'agent utilise les outils de migration intégrés (codemods) et guide pas à pas.
  ```
- **Requêtes sur l'état de l'application** :
  ```plaintext
  User: "Quels sont les layouts imbriqués dans /app/dashboard ?"
  → L'agent utilise `get_page_metadata` pour répondre.
  ```

---
### **Bonnes Pratiques**
- **Toujours lancer `pnpm dev`** avant de demander à l'agent d'interagir avec le serveur MCP.
- **Vérifier la connexion** : Si l'agent ne détecte pas le serveur, redémarrer `pnpm dev`.
- **Utiliser les outils pour valider le code** : Exemple : `"Vérifie que ma Server Action est correctement typée."`

---

## **📁 Structure du Projet**
```
/
├── app/                  # App Router (tout nouveau code ici)
│   ├── (marketing)/      # Groupe de routes (ex: /about, /pricing)
│   ├── dashboard/        # Layouts imbriqués pour les pages protégées
│   ├── [lang]/           # i18n avec next-intl (ex: /fr, /en)
│   ├── api/              # API Routes (pour les endpoints publics)
│   ├── layout.tsx        # Root layout (obligatoire : <html>, <body>)
│   ├── page.tsx          # Page d'accueil (/)
│   ├── loading.tsx       # Squelette de chargement
│   ├── error.tsx         # Boundary d'erreur (Client Component)
│   └── not-found.tsx     # Page 404 personnalisée
├── components/           # Composants partagés (Server Components par défaut)
├── lib/                  # Logique métier, clients DB (ex: Supabase), utilities
├── messages/             # Fichiers de traduction pour next-intl (ex: fr.json)
├── public/               # Assets statiques (images, fonts)
├── middleware.ts         # Logique Edge (auth, redirections)
├── next.config.js        # Configuration Next.js (images, headers, etc.)
├── .mcp.json             # Configuration du serveur MCP pour Next.js
└── AGENTS.md             # Ce fichier
```

---
## **🚀 Conventions de Développement**
### **1. Next.js App Router (2026)**
- **Server Components par défaut** : Toujours utiliser des Server Components sauf si nécessaire.
  - ❌ **À éviter** : `"use client"` au niveau racine (ex: `app/layout.tsx`).
  - ✅ **À faire** : Limiter `"use client"` aux feuilles (boutons, formulaires interactifs).

- **Server Actions** : Pour les mutations simples (formulaires, CRUD).
  - **Exemple** :
    ```tsx
    // app/contact/actions.ts
    "use server";
    export async function submitContact(formData: FormData) {
      const supabase = createClient();
      await supabase.from("contacts").insert({
        name: formData.get("name"),
        email: formData.get("email"),
      });
      redirect("/thank-you");
    }
    ```

- **Data Fetching** :
  - **Parallel Fetching** : Utiliser `Promise.all` pour les requêtes indépendantes.
    ```tsx
    const [user, posts] = await Promise.all([getUser(), getPosts()]);
    ```
  - **Streaming** : Envelopper les composants lents dans `<Suspense>`.
    ```tsx
    <Suspense fallback={<Loader />}>
      <SlowComponent />
    </Suspense>
    ```
  - **Cache** :
    - `fetch(..., { next: { revalidate: 3600 } })` : Cache 1h (données partagées).
    - `fetch(..., { cache: "no-store" })` : Toujours frais (données utilisateur).
    - `export const dynamic = "force-static"` : Page statique.

- **Metadata SEO** : Utiliser `generateMetadata` pour les métadonnées dynamiques.
  ```tsx
  export async function generateMetadata({ params }) {
    const { slug } = await params;
    const post = await getPost(slug);
    return { title: post.title, openGraph: { images: [post.ogImage] } };
  }
  ```

- **i18n avec next-intl** :
  - Structure : `app/[locale]/page.tsx`.
  - **Exemple de layout** :
    ```tsx
    // app/[locale]/layout.tsx
    import { NextIntlClientProvider } from "next-intl";
    import { getMessages } from "next-intl/server";
    export default async function LocaleLayout({ children, params: { locale } }) {
      const messages = await getMessages();
      return (
        <html lang={locale}>
          <body>
            <NextIntlClientProvider locale={locale} messages={messages}>
              {children}
            </NextIntlClientProvider>
          </body>
        </html>
      );
    }
    ```

### **2. Style et UI**
- **Tailwind CSS v4** + **shadcn/ui** :
  - Toujours utiliser les composants du design system (pas de styles inline).
  - **Exemple** :
    ```tsx
    // ✅ Bon
    <Button variant="primary" size="lg">Submit</Button>
    // ❌ À éviter
    <button className="bg-blue-500 text-white p-2 rounded">Submit</button>
    ```
- **Images** : Toujours utiliser `<Image />` de Next.js.
  ```tsx
  import Image from "next/image";
  <Image src="/logo.png" alt="Logo" width={100} height={50} />
  ```

### **3. Sécurité**
- **Variables d'environnement** :
  - Client : Préfixer par `NEXT_PUBLIC_` (ex: `NEXT_PUBLIC_API_URL`).
  - Serveur : Accès direct dans les Server Components (ex: `process.env.DB_URL`).
- **Middleware** : Pour la logique Edge (ex: auth).
  ```tsx
  // middleware.ts
  import { NextResponse } from "next/server";
  export function middleware(request) {
    const token = request.cookies.get("auth-token");
    if (!token && request.nextUrl.pathname.startsWith("/dashboard")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.next();
  }
  export const config = { matcher: ["/dashboard/:path*"], };
  ```

---
## **🧪 Testing et Qualité**
- **Outils** : Vitest (tests unitaires), Playwright (E2E), TypeScript (typage strict).
- **Règles** :
  - Pas de `any` TypeScript.
  - Pas de `console.log` en production.
  - **Tests obligatoires** pour toute nouvelle fonctionnalité.
  - **Commandes** :
    ```bash
    pnpm test:unit    # Vitest
    pnpm test:e2e     # Playwright
    pnpm type-check   # Vérification TypeScript
    ```

---
## **🚢 Déploiement**
- **Vercel** (recommandé) :
  ```bash
  vercel --prod
  ```
- **Docker** :
  ```dockerfile
  FROM node:20-alpine
  WORKDIR /app
  COPY . .
  RUN pnpm install && pnpm build
  CMD ["pnpm", "start"]
  ```
- **Checklist avant déploiement** :
  - [ ] `pnpm build` sans erreurs.
  - [ ] Score Lighthouse > 90.
  - [ ] Toutes les pages ont des métadonnées SEO (`generateMetadata`).
  - [ ] Images optimisées (`<Image />`).
  - [ ] Variables d'environnement sécurisées.

---
## **📜 Conventions de Code**
| Règle | Bon | Mauvais |
|-------|-----|--------|
| **Composants** | Petits, focalisés, Server Components par défaut | Fichiers monolithiques, `"use client"` inutile |
| **Nommage** | `getUser()` (verbe + nom) | `fetchData()` (trop générique) |
| **Types** | `type User = { id: string; name: string; }` | `any` |
| **Imports** | Ordonnés par groupe (React, Next.js, local) | Imports désordonnés |
| **Commentaires** | Seulement pour expliquer le "pourquoi", pas le "comment" | Code commenté sans valeur ajoutée |

---
## **🚫 À Éviter Absolument**
- ❌ **Ignorer le contexte** : Relire les fichiers dans `useful-context` avant d'utiliser des outils.
- ❌ **Séquentialité inutile** : Regrouper les appels d'outils parallèles (ex: `Promise.all`).
- ❌ **Sur-ingénierie** : Ne pas ajouter de fonctionnalités non demandées.
- ❌ **Styles inline** : Toujours utiliser Tailwind + design system.
- ❌ **Oublier le responsive** : Tester sur mobile (`@media` dans `globals.css`).
- ❌ **Utiliser `/pages`** : Tout nouveau code doit être dans `/app`.
- ❌ **Server Components dans Client Components** : ❌ Interdit. Passer les données en props.
- ❌ **`useState`/`useEffect` dans un Server Component** : ❌ Ajouter `"use client"`.

---
## **📌 Exemples de Tâches**
### **1. Créer une page avec Server Action**
**Demande** : *"Crée une page de contact avec un formulaire qui envoie les données à Supabase."*

**Réponse attendue** :
- Formulaire avec validation (Zod).
- **Server Action** pour l'envoi (pas d'API Route).
- Design responsive (shadcn/ui).
- Redirection vers `/thank-you`.

**Code** :
```tsx
// app/contact/actions.ts
"use server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
});

export async function submitContact(formData: FormData) {
  const validated = schema.parse({
    name: formData.get("name"),
    email: formData.get("email"),
  });
  const supabase = createClient();
  await supabase.from("contacts").insert(validated);
  redirect("/thank-you");
}

// app/contact/page.tsx
import { submitContact } from "./actions";
export default function ContactPage() {
  return (
    <form action={submitContact} className="space-y-4">
      <input name="name" required className="input" />
      <input name="email" type="email" required className="input" />
      <button type="submit" className="btn">Envoyer</button>
    </form>
  );
}
```

### **2. Debugger une erreur Next.js avec MCP**
**Demande** : *"Pourquoi ma page /dashboard affiche une erreur de hydration ?"*

**Workflow** :
1. L'agent utilise `get_errors` (Next.js MCP) pour récupérer les erreurs en temps réel.
2. Il identifie un mismatch entre le rendu serveur et client (ex: `useState` dans un Server Component).
3. Il propose une correction :
   ```tsx
   // ❌ Avant (erreur de hydration)
   export default function Dashboard() {
     const [data, setData] = useState([]); // ❌ useState dans un Server Component
     return <div>{data}</div>;
   }

   // ✅ Après
   export default async function Dashboard() {
     const data = await fetchData(); // ✅ Server Component
     return <div>{data}</div>;
   }
   ```

---
## **🔗 Références Externes**
- [Next.js App Router Docs](https://nextjs.org/docs/app) (officiel, 2026).
- [Next.js MCP Guide](https://nextjs.org/docs/app/guides/mcp.md).
- [next-intl (i18n)](https://next-intl-docs.vercel.app/).
- [Turbopack](https://turbo.build/pack).

---
## **📝 Notes pour les Agents**
- **Priorité aux Server Components** : Toujours vérifier si une tâche peut être faite en Server Component avant d’ajouter `"use client"`.
- **Utiliser les outils MCP** :
  - **Next.js** : `get_errors`, `get_page_metadata`, `get_routes` pour du debugging en temps réel.
- **Vérifier `useful-context`** : Ne pas relire des fichiers déjà fournis.
- **Respecter le design system** : Toujours utiliser les composants shadcn/ui et les tokens Tailwind.
- **Sécurité** :
  - **Ne jamais exposer de clés secrètes** dans le code ou les logs.
  - **Toujours valider les données utilisateur** (ex: Zod pour les formulaires).