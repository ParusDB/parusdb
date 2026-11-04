"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFirstAdmin } from "@/app/auth/onboarding/actions";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";

// Formulaire d'onboarding du premier démarrage : le compte créé reçoit le
// rôle Administrateur (validation et garde côté serveur, cf. actions.ts).
export function OnboardingForm() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleOnboarding = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setIsLoading(true);
    setError(null);
    try {
      const result = await createFirstAdmin(formData);
      if (!result.ok) {
        setError(result.error ?? "La création du compte a échoué.");
        setIsLoading(false);
      }
      // Succès : la Server Action redirige vers /chat.
    } catch {
      setError("La création du compte a échoué : erreur inattendue.");
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleOnboarding}>
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 rounded-2xl border border-jaune/30 bg-jaune/10 p-4">
          <ShieldCheck
            className="mt-0.5 size-5 shrink-0 text-jaune"
            strokeWidth={1.7}
          />
          <p className="text-sm text-muted-foreground">
            Ce premier compte administre la plateforme : utilisateurs, rôles,
            lakehouse et connecteurs. Les comptes suivants seront créés par
            l&apos;administration.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="first-name">Prénom</Label>
            <Input
              id="first-name"
              name="firstName"
              placeholder="Camille"
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="last-name">Nom</Label>
            <Input id="last-name" name="lastName" placeholder="Moreau" />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="prenom.nom@entreprise.fr"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Mot de passe</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="repeat-password">Répéter le mot de passe</Label>
          <Input
            id="repeat-password"
            name="repeatPassword"
            type="password"
            required
            minLength={8}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button
          type="submit"
          className="w-full rounded-full bg-jaune font-semibold text-charbon shadow-[0_20px_60px_-20px_rgba(255,215,0,0.5)] transition-transform hover:-translate-y-0.5"
          disabled={isLoading}
        >
          {isLoading ? "Initialisation de la plateforme…" : "Créer mon compte Administrateur"}
        </Button>
      </div>
    </form>
  );
}
