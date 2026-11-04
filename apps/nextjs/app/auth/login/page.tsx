import { AuthShell } from "@/components/parus/auth-shell";
import { LoginForm } from "@/components/login-form";
import { isFirstInstall } from "@/lib/onboarding";
import { redirect } from "next/navigation";

// Premier démarrage : aucun compte n'existe - la page de connexion cède la
// place à l'onboarding (création du compte Administrateur, spec §Onboarding).
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
      title="Connexion"
      description="Accédez à votre plateforme data : chat IA, lakehouse et connecteurs."
    >
      <LoginForm />
    </AuthShell>
  );
}
