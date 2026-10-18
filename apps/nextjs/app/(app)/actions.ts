"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// Changement de rôle actif (spec §Rôles et Permissions : sans déconnexion).
// La validation du rôle appartient à l'utilisateur est assurée par la
// politique RLS active_role_write_own.
export async function switchActiveRole(roleId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { error } = await supabase
    .schema("iam")
    .from("user_active_role")
    .upsert({ user_id: user.id, role_id: roleId }, { onConflict: "user_id" });
  if (error) {
    throw new Error(
      `Le changement de rôle a échoué : ${error.message}`,
    );
  }
  revalidatePath("/", "layout");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/auth/login");
}
