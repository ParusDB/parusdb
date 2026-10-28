import { createAdminClient } from "@/lib/supabase/admin";

// Première installation : aucun compte n'existe encore. Condition de
// l'onboarding (spec §Onboarding) : le premier écran de création de compte
// n'est proposé que dans cet état, et la Server Action re-vérifie la même
// condition avant d'attribuer le rôle Administrateur — jamais sur la base
// d'un état côté client (AGENTS.md §7).
export async function isFirstInstall(): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });
  if (error) {
    throw new Error(
      `Impossible de vérifier les comptes existants : ${error.message}`,
    );
  }
  return (data?.total ?? data?.users?.length ?? 0) === 0;
}
