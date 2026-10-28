"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isFirstInstall } from "@/lib/onboarding";
import { redirect } from "next/navigation";

export interface OnboardingResult {
  ok: boolean;
  error?: string;
}

// Onboarding du premier démarrage : crée le premier compte avec le rôle
// Administrateur, sans lien de confirmation email (installation locale,
// l'incident « compte sans rôle » est ainsi éliminé à la racine). Le trigger
// iam.on_auth_user_created reste le filet de sécurité des sign-up normaux :
// l'attribution explicite ci-dessous couvre le cas où il manquerait.
export async function createFirstAdmin(
  formData: FormData,
): Promise<OnboardingResult> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const repeatPassword = String(formData.get("repeatPassword") ?? "");
  const firstName = String(formData.get("firstName") ?? "").trim() || null;
  const lastName = String(formData.get("lastName") ?? "").trim() || null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "L'adresse email est invalide." };
  }
  if (password.length < 8) {
    return {
      ok: false,
      error: "Le mot de passe doit contenir au moins 8 caractères.",
    };
  }
  if (password !== repeatPassword) {
    return { ok: false, error: "Les mots de passe ne correspondent pas." };
  }

  // Garde anti-détournement : l'attribution du rôle Administrateur n'est
  // possible que tant qu'aucun compte n'existe. Re-vérifiée ici (jamais sur
  // la seule décision de la page) : sinon n'importe qui pourrait se créer
  // administrateur une fois la plateforme peuplée.
  let firstInstall: boolean;
  try {
    firstInstall = await isFirstInstall();
  } catch {
    return {
      ok: false,
      error:
        "La vérification des comptes existants a échoué : réessayez, ou connectez-vous si l'installation est déjà administrée.",
    };
  }
  if (!firstInstall) {
    return {
      ok: false,
      error:
        "Cette installation a déjà un administrateur : créez votre compte depuis la page « Créer un compte » puis faites-vous attribuer un rôle.",
    };
  }

  const admin = createAdminClient();

  // Compte confirmé d'emblée (email_confirm) : pas de lien de confirmation,
  // l'utilisateur ouvre la session immédiatement.
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName },
  });
  if (error || !data.user) {
    return {
      ok: false,
      error: `La création du compte a échoué : ${error?.message ?? "erreur inattendue"}`,
    };
  }
  const userId = data.user.id;

  try {
    // Profil + rôle admin explicites (idempotents : le trigger a déjà pu
    // faire le travail pour le premier compte).
    await admin
      .schema("iam")
      .from("user_profiles")
      .upsert(
        { id: userId, first_name: firstName, last_name: lastName },
        { onConflict: "id" },
      );
    const { data: role, error: roleError } = await admin
      .schema("iam")
      .from("roles")
      .select("id")
      .eq("key", "admin")
      .maybeSingle();
    if (roleError || !role) {
      throw new Error(
        `rôle système « admin » introuvable (${roleError?.message ?? "absent"})`,
      );
    }
    await admin
      .schema("iam")
      .from("user_roles")
      .upsert(
        { user_id: userId, role_id: role.id },
        { onConflict: "user_id,role_id" },
      );
    await admin
      .schema("iam")
      .from("user_active_role")
      .upsert({ user_id: userId, role_id: role.id }, { onConflict: "user_id" });
  } catch (e: unknown) {
    return {
      ok: false,
      error: `Le compte est créé, mais l'attribution du rôle Administrateur a échoué : ${
        e instanceof Error ? e.message : "erreur inattendue"
      }. Connectez-vous puis réessayez depuis l'administration.`,
    };
  }

  // Session ouverte immédiatement : le mot de passe vient d'être fourni par
  // l'utilisateur, le BFF n'en conserve rien.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    return {
      ok: false,
      error: `Le compte Administrateur est créé : connectez-vous (${signInError.message}).`,
    };
  }
  redirect("/chat");
}
