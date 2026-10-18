"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";
import type { ProprietaryModel } from "@/types/db";

// ---------------------------------------------------------------------------
// Utilisateurs (spec §Administration — Utilisateurs)
// ---------------------------------------------------------------------------

export interface AdminUserInput {
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  roleIds: string[];
}

// 100 ans de bannissement = « désactivé » (GoTrue n'a pas de booléen dédié).
const BAN_FOREVER = "876000h";

export async function createUser(input: AdminUserInput): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("admin.users");
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email.trim(),
    password: input.password ?? "",
    email_confirm: true,
  });
  if (error || !data.user) {
    return { ok: false, error: `La création a échoué : ${error?.message ?? "erreur inattendue"}` };
  }
  const userId = data.user.id;

  // Profil + rôles : le trigger iam.on_auth_user_created a déjà posé le rôle
  // par défaut (metier) ; on ajuste avec la sélection de l'administrateur.
  await admin
    .schema("iam")
    .from("user_profiles")
    .upsert({
      id: userId,
      first_name: input.firstName?.trim() || null,
      last_name: input.lastName?.trim() || null,
      phone: input.phone?.trim() || null,
    });
  await syncUserRoles(admin, userId, input.roleIds);
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function updateUser(
  userId: string,
  input: Omit<AdminUserInput, "email" | "password">,
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("admin.users");
  const admin = createAdminClient();
  const { error } = await admin
    .schema("iam")
    .from("user_profiles")
    .update({
      first_name: input.firstName?.trim() || null,
      last_name: input.lastName?.trim() || null,
      phone: input.phone?.trim() || null,
    })
    .eq("id", userId);
  if (error) {
    return { ok: false, error: `La mise à jour a échoué : ${error.message}` };
  }
  await syncUserRoles(admin, userId, input.roleIds);
  revalidatePath("/admin/users");
  return { ok: true };
}

async function syncUserRoles(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  roleIds: string[],
) {
  if (roleIds.length === 0) return;
  await admin
    .schema("iam")
    .from("user_roles")
    .delete()
    .eq("user_id", userId);
  await admin.schema("iam").from("user_roles").insert(
    roleIds.map((roleId) => ({ user_id: userId, role_id: roleId })),
  );
  const { data: active } = await admin
    .schema("iam")
    .from("user_active_role")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!active) {
    await admin.schema("iam").from("user_active_role").upsert({
      user_id: userId,
      role_id: roleIds[0],
    });
  }
}

export async function setUserStatus(
  userId: string,
  disabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("admin.users");
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: disabled ? BAN_FOREVER : "none",
  });
  if (error) {
    return { ok: false, error: `Le changement de statut a échoué : ${error.message}` };
  }
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function deleteUser(
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("admin.users");
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    return { ok: false, error: `La suppression a échoué : ${error.message}` };
  }
  revalidatePath("/admin/users");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rôles (spec §Administration — Rôles)
// ---------------------------------------------------------------------------

export async function createRole(input: {
  key: string;
  name: string;
  description: string;
  permissions: string[];
}): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("admin.roles");
  const admin = createAdminClient();
  const { error } = await admin.schema("iam").from("roles").insert({
    key: input.key.trim(),
    name: input.name.trim(),
    description: input.description.trim() || null,
    permissions: input.permissions,
    is_system: false,
  });
  if (error) {
    return { ok: false, error: `La création a échoué : ${error.message}` };
  }
  revalidatePath("/admin/roles");
  return { ok: true };
}

export async function updateRole(
  roleId: string,
  input: {
    name: string;
    description: string;
    permissions: string[];
  },
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("admin.roles");
  const admin = createAdminClient();
  const { error } = await admin
    .schema("iam")
    .from("roles")
    .update({
      name: input.name.trim(),
      description: input.description.trim() || null,
      permissions: input.permissions,
    })
    .eq("id", roleId);
  if (error) {
    return { ok: false, error: `La mise à jour a échoué : ${error.message}` };
  }
  revalidatePath("/admin/roles");
  return { ok: true };
}

export async function deleteRole(
  roleId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("admin.roles");
  const admin = createAdminClient();
  const { count } = await admin
    .schema("iam")
    .from("user_roles")
    .select("user_id", { count: "exact", head: true })
    .eq("role_id", roleId);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `Impossible de supprimer : ${count} utilisateur(s) ont encore ce rôle. Retirez-le d'abord.`,
    };
  }
  const { error } = await admin
    .schema("iam")
    .from("roles")
    .delete()
    .eq("id", roleId)
    .eq("is_system", false);
  if (error) {
    return { ok: false, error: `La suppression a échoué : ${error.message}` };
  }
  revalidatePath("/admin/roles");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Serveurs locaux (spec §Administration — Serveurs locaux)
// ---------------------------------------------------------------------------

export async function upsertServer(input: {
  id?: string;
  kind: "s3" | "llm";
  name: string;
  server_type: string;
  url: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("admin.servers");
  const admin = createAdminClient();
  const payload = {
    kind: input.kind,
    name: input.name.trim(),
    server_type: input.server_type.trim().toLowerCase(),
    url: input.url.trim(),
    status: "disconnected" as const,
  };
  if (input.id) {
    const { error } = await admin
      .schema("admin")
      .from("servers")
      .update(payload)
      .eq("id", input.id);
    if (error) return { ok: false, error: `La mise à jour a échoué : ${error.message}` };
  } else {
    const { error } = await admin.schema("admin").from("servers").insert(payload);
    if (error) return { ok: false, error: `L'enregistrement a échoué : ${error.message}` };
  }
  revalidatePath("/admin/servers");
  return { ok: true };
}

export async function deleteServer(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("admin.servers");
  const admin = createAdminClient();
  const { error } = await admin.schema("admin").from("servers").delete().eq("id", id);
  if (error) {
    return { ok: false, error: `La suppression a échoué : ${error.message}` };
  }
  revalidatePath("/admin/servers");
  return { ok: true };
}

// Test de connexion : LLM -> /api/tags, S3 -> simple requête HTTP. Les URLs
// internes Docker (ex. http://rustfs:9000) ne sont pas joignables depuis
// l'application hôte : le message l'explique.
export async function testServer(
  id: string,
): Promise<{ ok: boolean; error?: string; status?: "connected" | "disconnected" }> {
  await requirePermission("admin.servers");
  const admin = createAdminClient();
  const { data: server } = await admin
    .schema("admin")
    .from("servers")
    .select("id, kind, url")
    .eq("id", id)
    .maybeSingle();
  if (!server) return { ok: false, error: "Serveur introuvable." };

  let connected = false;
  let error: string | undefined;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const url = server.kind === "llm" ? `${server.url}/api/tags` : server.url;
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timeout);
    connected = res.ok;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    connected = false;
    error =
      e instanceof Error
        ? `inaccessible depuis l'application (${e.name === "TimeoutError" || e.name === "AbortError" ? "délai dépassé" : e.message}) — une URL interne Docker n'est pas joignable depuis l'hôte`
        : "erreur inattendue";
  }

  await admin
    .schema("admin")
    .from("servers")
    .update({
      status: connected ? "connected" : "disconnected",
      last_tested_at: new Date().toISOString(),
    })
    .eq("id", id);
  revalidatePath("/admin/servers");
  return {
    ok: true,
    status: connected ? "connected" : "disconnected",
    error: connected ? undefined : error,
  };
}

// ---------------------------------------------------------------------------
// Modèles LLM propriétaires (spec §Administration — Modèles LLM)
// ---------------------------------------------------------------------------

export async function addProprietaryModel(input: {
  provider: ProprietaryModel["provider"] | "custom";
  model: string;
  apiKey: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("admin.servers");
  if (!input.apiKey.trim() || !input.model.trim()) {
    return { ok: false, error: "Le modèle et la clé API sont obligatoires." };
  }
  const admin = createAdminClient();
  const session = await requirePermission("admin.servers");
  const { error } = await admin.schema("admin").from("proprietary_models").insert({
    provider: input.provider,
    model: input.model.trim(),
    api_key_encrypted: encryptSecret(input.apiKey.trim()),
    created_by: session.userId,
  });
  if (error) {
    return { ok: false, error: `L'ajout a échoué : ${error.message}` };
  }
  revalidatePath("/admin/servers");
  return { ok: true };
}

export async function updateProprietaryModel(
  id: string,
  input: { model: string; apiKey: string },
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("admin.servers");
  const admin = createAdminClient();
  const payload: Record<string, unknown> = { model: input.model.trim() };
  if (input.apiKey.trim()) {
    payload.api_key_encrypted = encryptSecret(input.apiKey.trim());
  }
  const { error } = await admin
    .schema("admin")
    .from("proprietary_models")
    .update(payload)
    .eq("id", id);
  if (error) {
    return { ok: false, error: `La mise à jour a échoué : ${error.message}` };
  }
  revalidatePath("/admin/servers");
  return { ok: true };
}

export async function deleteProprietaryModel(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("admin.servers");
  const admin = createAdminClient();
  const { error } = await admin
    .schema("admin")
    .from("proprietary_models")
    .delete()
    .eq("id", id);
  if (error) {
    return { ok: false, error: `La suppression a échoué : ${error.message}` };
  }
  revalidatePath("/admin/servers");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tickets support (spec §Support)
// ---------------------------------------------------------------------------

export async function createTicket(input: {
  subject: string;
  message: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Vous devez être connecté." };
  }
  if (!input.subject.trim() || !input.message.trim()) {
    return { ok: false, error: "L'objet et le message sont obligatoires." };
  }
  const { error } = await supabase.schema("support").from("tickets").insert({
    owner_id: user.id,
    subject: input.subject.trim().slice(0, 200),
    message: input.message.trim(),
  });
  if (error) {
    return { ok: false, error: `La création du ticket a échoué : ${error.message}` };
  }
  revalidatePath("/support");
  return { ok: true };
}

export async function closeTicket(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("admin.users");
  const admin = createAdminClient();
  const { error } = await admin
    .schema("support")
    .from("tickets")
    .update({ status: "closed" })
    .eq("id", id);
  if (error) {
    return { ok: false, error: `La clôture a échoué : ${error.message}` };
  }
  revalidatePath("/support");
  return { ok: true };
}
