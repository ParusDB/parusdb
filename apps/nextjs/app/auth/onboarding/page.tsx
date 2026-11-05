import { AuthShell } from "@/components/parus/auth-shell";
import { OnboardingForm } from "@/components/onboarding-form";
import { isFirstInstall } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";

// Premier démarrage : la plateforme n'a aucun compte. Écran « moment fort »
// de la charte, proposé à la place du login - le compte créé reçoit le rôle
// Administrateur. Dès qu'un compte existe, cette page redirige vers le
// login : l'onboarding n'est jouable qu'une seule fois.
export const instant = false;

export default async function Page() {
  // Rendu bloquant à la requête AVANT tout accès Supabase : le client
  // supabase-js évalue Date.now() en interne (getUser), ce que cacheComponents
  // rejette en prerender (« unstable value Date.now() »). Cette page ne passe
  // pas par getSessionContext (point de fix unique, AGENTS.md §7) : correctif
  // ponctuel ici, même pattern que lib/session.ts.
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect("/chat");
  }

  let firstInstall: boolean;
  try {
    firstInstall = await isFirstInstall();
  } catch {
    // Impossible de statuer (clé service_role absente, base injoignable) :
    // on renvoie vers le login plutôt que d'exposer l'onboarding.
    redirect("/auth/login");
  }
  if (!firstInstall) {
    redirect("/auth/login");
  }

  return (
    <AuthShell
      title="Bienvenue sur ParusDB"
      description="Vous êtes le premier utilisateur de cette installation : votre compte recevra le rôle Administrateur."
    >
      <OnboardingForm />
    </AuthShell>
  );
}
