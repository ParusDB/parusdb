import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Client administrateur : clé service_role, serveur uniquement.
// Ne jamais importer ce module depuis un composant client ni exposer la clé
// via un préfixe NEXT_PUBLIC_ (AGENTS.md §9).
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Le client administrateur exige NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
