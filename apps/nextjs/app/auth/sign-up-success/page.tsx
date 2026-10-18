import { AuthShell } from "@/components/parus/auth-shell";
import Link from "next/link";

export default function Page() {
  return (
    <AuthShell
      title="Vérifiez votre email"
      description="Votre compte a été créé. Ouvrez le lien de confirmation envoyé par email pour activer votre accès."
    >
      <p className="text-sm text-muted-foreground">
        Une fois votre email confirmé, connectez-vous depuis la page de
        connexion. Le premier compte créé devient administrateur de la
        plateforme.
      </p>
      <p className="mt-4 text-sm">
        <Link href="/auth/login" className="underline underline-offset-4">
          Retour à la connexion
        </Link>
      </p>
    </AuthShell>
  );
}
