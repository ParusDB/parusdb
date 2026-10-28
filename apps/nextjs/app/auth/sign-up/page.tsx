import { AuthShell } from "@/components/parus/auth-shell";
import { SignUpForm } from "@/components/sign-up-form";
import { isFirstInstall } from "@/lib/onboarding";
import { redirect } from "next/navigation";

// Premier démarrage : aucun compte n'existe — la création passe par
// l'onboarding (rôle Administrateur, sans lien de confirmation email) ;
// le sign-up classique (avec lien de confirmation) reprend ensuite la main.
export const instant = false;

export default async function Page() {
  let firstInstall: boolean;
  try {
    firstInstall = await isFirstInstall();
  } catch {
    firstInstall = false;
  }
  if (firstInstall) {
    redirect("/auth/onboarding");
  }

  return (
    <AuthShell
      title="Créer un compte"
      description="Votre email recevra un lien de confirmation. Aucune donnée ne quitte votre infrastructure."
    >
      <SignUpForm />
    </AuthShell>
  );
}
