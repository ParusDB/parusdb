"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useState } from "react";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleForgotPassword = async (
    e: React.FormEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/update-password`,
      });
      if (error) throw error;
      setSuccess(true);
    } catch (error: unknown) {
      setError(
        error instanceof Error
          ? `L’envoi a échoué : ${error.message}`
          : "L’envoi a échoué : erreur inattendue.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Si un compte existe pour cette adresse, un email de réinitialisation
          vient d’être envoyé. Ouvrez le lien qu’il contient pour définir un
          nouveau mot de passe.
        </p>
        <Link href="/auth/login" className="text-sm underline underline-offset-4">
          Retour à la connexion
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleForgotPassword}>
      <div className="flex flex-col gap-5">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="prenom.nom@entreprise.fr"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button
          type="submit"
          className="w-full rounded-full bg-jaune font-semibold text-charbon shadow-[0_20px_60px_-20px_rgba(255,215,0,0.5)] transition-transform hover:-translate-y-0.5"
          disabled={isLoading}
        >
          {isLoading ? "Envoi…" : "Envoyer le lien de réinitialisation"}
        </Button>
      </div>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Déjà un compte ?{" "}
        <Link href="/auth/login" className="underline underline-offset-4">
          Se connecter
        </Link>
      </p>
    </form>
  );
}
