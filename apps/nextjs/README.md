# ParusDB — Interface (Next.js)

Application web ParusDB : frontend + BFF (Backend-For-Frontend) en Next.js 16
(App Router, React 19, TypeScript strict, Tailwind CSS v4 + shadcn/ui,
`cacheComponents` activé, proxy à la racine pour le refresh de session).

Toute l'interface est en français, la charte appliquée est « Mésange
Charbonnière » (`docs/functional/brand_guidelines.md` — tokens dans
`app/globals.css`, polices Inter / Space Grotesk / JetBrains Mono via
`next/font`).

## Démarrage

```bash
npm install
npm run dev        # http://localhost:3000
```

Prérequis : les stacks `apps/supabase` (avec overrides `rustfs` +
`rustfs-restart`), `apps/polaris`, `apps/trino`, `apps/mcp-trino` et
`apps/ollama` démarrées. Copier `.env.example` en `.env.local` et renseigner
les valeurs locales (les secrets se récupèrent depuis les `.env` des stacks,
jamais commités).

## Fonctionnalités

| Section | Route | État |
|---|---|---|
| Connexion / inscription / réinitialisation | `/auth/*` | Fonctionnel (charte : charbon + grille + halo jaune) |
| Chat IA (Ollama + mcp-trino, streaming SSE) | `/chat` | Fonctionnel — question → exploration lakehouse → SQL → réponse |
| Agents IA (CRUD, modèles, sources) | `/agents` | Fonctionnel |
| Data Lakehouse (catalogues Polaris, éditeur SQL Trino) | `/data-lakehouse` | Fonctionnel |
| Connecteurs ELT (dlt) | `/connectors` | Interfaces mockées — exécution simulée, moteur non intégré |
| Administration (utilisateurs, rôles, serveurs, facturation) | `/admin/*` | Fonctionnel |
| Support (documentation, tickets) | `/support` | Fonctionnel |

## Architecture applicative

- **Auth** : Supabase self-hosted via la gateway (`http://localhost:8000`,
  Envoy par défaut — Kong optionnel sur le même port). Les clients vivent dans
  `lib/supabase/` (`client.ts` navigateur, `server.ts` RSC/actions,
  `admin.ts` clé service_role — serveur uniquement). Le refresh de session est
  assuré par `proxy.ts` → `lib/supabase/proxy.ts`.
- **RBAC** : rôles applicatifs et permissions dans PostgreSQL (schéma `iam`,
  tables `roles`, `user_roles`, `user_active_role`, fonction
  `iam.has_permission`). Le rôle actif se change en bas de sidebar sans se
  déconnecter. Les permissions filtrent la navigation ET l'accès serveur
  (`lib/session.ts` : `requirePermission`).
- **Schémas métier PostgreSQL** : `iam`, `agents`, `chat`, `lakehouse`,
  `connectors`, `admin`, `support` — DDL versionné et idempotent dans
  `apps/supabase/sql/01-parusdb-app.sql` (RLS partout, TO authenticated +
  prédicat d'appartenance). PostgREST les expose via `PGRST_DB_SCHEMAS` ;
  côté client, `supabase.schema('<schéma>')` envoie `Accept-Profile`.
- **Chat IA** : route SSE `app/(app)/chat/[id]/stream/route.ts` — boucle
  Ollama (function calling) ↔ mcp-trino (lecture seule), messages persistés
  dans `chat.messages`, titre généré par l'IA, requêtes SQL journalisées dans
  `lakehouse.query_history`. Le modèle ne reçoit aucune chaîne de connexion.
- **Lakehouse** : CRUD des catalogues via l'API Management Polaris
  (`lib/polaris.ts`), requêtage via Trino (`lib/trino.ts`), exploration des
  schémas/tables/colonnes via `information_schema`, métriques disque via les
  tables metadata `$files`. La création d'un catalogue génère le binding Trino
  (`TRINO_CATALOG_DIR`) — redémarrage Trino requis pour l'activer.
- **Secrets** : credentials des connecteurs et clés API LLM chiffrés
  AES-256-GCM (`lib/crypto.ts`, clé `PARUSDB_ENCRYPTION_KEY`), jamais
  renvoyés au client.

## Notes

- L'exécution des modèles propriétaires (OpenAI, Anthropic…) n'est pas encore
  active : les clés se configurent en administration, mais les conversations
  exigent un modèle Ollama local pour l'instant.
- Les pages du groupe `(app)` sont dynamiques (session par cookies) :
  `export const instant = false` sur chaque page avec `cacheComponents`.
- Vérifications avant de livrer : `npm run lint`, `npx tsc --noEmit`,
  `npm run build` (§13 d'AGENTS.md).
