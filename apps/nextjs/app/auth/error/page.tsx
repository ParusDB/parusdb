import { AuthShell } from "@/components/parus/auth-shell";
import Link from "next/link";
import { Suspense } from "react";

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  const params = await searchParams;
  return (
    <p className="text-sm text-muted-foreground">
      {params?.error
        ? `La vérification a échoué : ${params.error}`
        : "La vérification a échoué : erreur inconnue."}{" "}
      Le lien a peut-être expiré - relancez la procédure depuis la page de
      connexion.
    </p>
  );
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  return (
    <AuthShell
      title="Une erreur est survenue"
      description="La vérification du lien n'a pas abouti."
    >
      <Suspense>
        <ErrorContent searchParams={searchParams} />
      </Suspense>
      <p className="mt-4 text-sm">
        <Link href="/auth/login" className="underline underline-offset-4">
          Retour à la connexion
        </Link>
      </p>
    </AuthShell>
  );
}
