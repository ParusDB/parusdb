import { AuthShell } from "@/components/parus/auth-shell";
import { OnboardingForm } from "@/components/onboarding-form";
import { isFirstInstall } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// Premier démarrage : la plateforme n'a aucun compte. Écran « moment fort »
// de la charte, proposé à la place du login - le compte créé reçoit le rôle
// Administrateur. Dès qu'un compte existe, cette page redirige vers le
// login : l'onboarding n'est jouable qu'une seule fois.
export const instant = false;

export default async function Page() {
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
