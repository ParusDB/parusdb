import { AuthShell } from "@/components/parus/auth-shell";
import { LoginForm } from "@/components/login-form";

export default function Page() {
  return (
    <AuthShell
      title="Connexion"
      description="Accédez à votre plateforme data : chat IA, lakehouse et connecteurs."
    >
      <LoginForm />
    </AuthShell>
  );
}
