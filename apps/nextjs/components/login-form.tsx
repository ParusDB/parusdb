"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      router.push("/chat");
      router.refresh();
    } catch (error: unknown) {
      setError(
        error instanceof Error
          ? `La connexion a échoué : ${error.message}`
          : "La connexion a échoué : erreur inattendue.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleLogin}>
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
        <div className="grid gap-2">
          <div className="flex items-center">
            <Label htmlFor="password">Mot de passe</Label>
            <Link
              href="/auth/forgot-password"
              className="ml-auto inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Mot de passe oublié ?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button
          type="submit"
          className="w-full rounded-full bg-jaune font-semibold text-charbon shadow-[0_20px_60px_-20px_rgba(255,215,0,0.5)] transition-transform hover:-translate-y-0.5"
          disabled={isLoading}
        >
          {isLoading ? "Connexion…" : "Se connecter"}
        </Button>
      </div>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Pas encore de compte ?{" "}
        <Link href="/auth/sign-up" className="underline underline-offset-4">
          Créer un compte
        </Link>
      </p>
    </form>
  );
}
