import { AuthShell } from "@/components/parus/auth-shell";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default function Page() {
  return (
    <AuthShell
      title="Mot de passe oublié"
      description="Recevez un lien de réinitialisation par email."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
