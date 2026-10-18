import { AuthShell } from "@/components/parus/auth-shell";
import { SignUpForm } from "@/components/sign-up-form";

export default function Page() {
  return (
    <AuthShell
      title="Créer un compte"
      description="Votre email recevra un lien de confirmation. Aucune donnée ne quitte votre infrastructure."
    >
      <SignUpForm />
    </AuthShell>
  );
}
