import { AuthShell } from "@/components/parus/auth-shell";
import { UpdatePasswordForm } from "@/components/update-password-form";

export default function Page() {
  return (
    <AuthShell
      title="Nouveau mot de passe"
      description="Définissez le mot de passe de votre compte."
    >
      <UpdatePasswordForm />
    </AuthShell>
  );
}
