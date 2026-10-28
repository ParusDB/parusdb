"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";
import { deleteModel, validateModelName } from "@/lib/ollama";
import {
  discoverProviderModels,
  type ProviderApiKind,
} from "@/lib/providers";

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
  await requireAdmin();
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
  // par défaut (public) ; on ajuste avec la sélection de l'administrateur.
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
  await requireAdmin();
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
  // Le rôle actif doit rester un rôle attribué : s'il a été retiré, le
  // replier sur le premier rôle de la sélection.
  const { data: active } = await admin
    .schema("iam")
    .from("user_active_role")
    .select("role_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!active || !roleIds.includes(active.role_id)) {
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
  await requireAdmin();
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
  await requireAdmin();
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
}): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.schema("iam").from("roles").insert({
    key: input.key.trim(),
    name: input.name.trim(),
    description: input.description.trim() || null,
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
  },
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .schema("iam")
    .from("roles")
    .update({
      name: input.name.trim(),
      description: input.description.trim() || null,
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
  await requireAdmin();
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
    // Rôle propriétaire d'objets (agents, pipelines, catalogues) ou lié à un
    // utilisateur applicatif : la base refuse (ON DELETE RESTRICT).
    if (error.code === "23503") {
      return {
        ok: false,
        error:
          "Impossible de supprimer : ce rôle est propriétaire d'objets (agents, pipelines ou catalogues) ou utilisé par un utilisateur applicatif. Réaffectez-les d'abord.",
      };
    }
    return { ok: false, error: `La suppression a échoué : ${error.message}` };
  }
  revalidatePath("/admin/roles");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Fournisseurs LLM (spec §Administration — Fournisseurs LLM)
// ---------------------------------------------------------------------------

const API_KINDS: ProviderApiKind[] = [
  "openai",
  "anthropic",
  "mistral",
  "openai_compatible",
];

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("protocole invalide");
    }
    return trimmed;
  } catch {
    throw new Error("L'URL de base est invalide (attendu : http(s)://…).");
  }
}

// Ajout d'un fournisseur : la clé est validée par la découverte réelle des
// modèles — aucune sauvegarde si le fournisseur la rejette.
export async function addProvider(input: {
  name: string;
  apiKind: ProviderApiKind;
  baseUrl?: string;
  apiKey: string;
}): Promise<{ ok: boolean; error?: string; modelCount?: number }> {
  const session = await requireAdmin();
  const name = input.name.trim();
  if (!name || !input.apiKey.trim()) {
    return { ok: false, error: "Le nom du fournisseur et la clé API sont obligatoires." };
  }
  if (!API_KINDS.includes(input.apiKind)) {
    return { ok: false, error: "Type d'API inconnu." };
  }
  let baseUrl: string | null = null;
  if (input.apiKind === "openai_compatible") {
    if (!input.baseUrl?.trim()) {
      return { ok: false, error: "L'URL de base est obligatoire pour un fournisseur compatible OpenAI." };
    }
    try {
      baseUrl = normalizeBaseUrl(input.baseUrl);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "URL invalide." };
    }
  }

  let modelCount: number;
  try {
    const models = await discoverProviderModels({
      apiKind: input.apiKind,
      apiKey: input.apiKey.trim(),
      baseUrl,
    });
    modelCount = models.length;
  } catch (e) {
    return {
      ok: false,
      error: `La clé a été rejetée par le fournisseur : ${e instanceof Error ? e.message : "erreur inconnue"}`,
    };
  }

  const admin = createAdminClient();
  const { error } = await admin.schema("admin").from("providers").insert({
    name,
    api_kind: input.apiKind,
    base_url: baseUrl,
    api_key_encrypted: encryptSecret(input.apiKey.trim()),
    created_by: session.userId,
  });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `Un fournisseur porte déjà le nom « ${name} ».` };
    }
    return { ok: false, error: `L'ajout a échoué : ${error.message}` };
  }
  revalidatePath("/admin/providers");
  return { ok: true, modelCount };
}

// Modification : renommer, changer de type d'API ; clé vide = conserver
// l'actuelle (elle n'est jamais renvoyée au client).
export async function updateProvider(
  id: string,
  input: {
    name: string;
    apiKind: ProviderApiKind;
    baseUrl?: string;
    apiKey?: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: "Le nom du fournisseur est obligatoire." };
  }
  if (!API_KINDS.includes(input.apiKind)) {
    return { ok: false, error: "Type d'API inconnu." };
  }
  let baseUrl: string | null = null;
  if (input.apiKind === "openai_compatible") {
    if (!input.baseUrl?.trim()) {
      return { ok: false, error: "L'URL de base est obligatoire pour un fournisseur compatible OpenAI." };
    }
    try {
      baseUrl = normalizeBaseUrl(input.baseUrl);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "URL invalide." };
    }
  }

  if (input.apiKey?.trim()) {
    try {
      await discoverProviderModels({
        apiKind: input.apiKind,
        apiKey: input.apiKey.trim(),
        baseUrl,
      });
    } catch (e) {
      return {
        ok: false,
        error: `La clé a été rejetée par le fournisseur : ${e instanceof Error ? e.message : "erreur inconnue"}`,
      };
    }
  }

  const admin = createAdminClient();
  const payload: Record<string, unknown> = {
    name,
    api_kind: input.apiKind,
    base_url: baseUrl,
  };
  if (input.apiKey?.trim()) {
    payload.api_key_encrypted = encryptSecret(input.apiKey.trim());
  }
  const { error } = await admin
    .schema("admin")
    .from("providers")
    .update(payload)
    .eq("id", id);
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `Un fournisseur porte déjà le nom « ${name} ».` };
    }
    return { ok: false, error: `La mise à jour a échoué : ${error.message}` };
  }
  revalidatePath("/admin/providers");
  return { ok: true };
}

export async function deleteProvider(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .schema("admin")
    .from("providers")
    .delete()
    .eq("id", id);
  if (error) {
    return { ok: false, error: `La suppression a échoué : ${error.message}` };
  }
  revalidatePath("/admin/providers");
  return { ok: true };
}

// Suppression d'un modèle local Ollama (spec §Fournisseurs LLM). Refusé si
// des agents l'utilisent encore : leur exécution échouerait silencieusement.
export async function deleteOllamaModel(
  model: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const name = validateModelName(model);
  if (!name) {
    return {
      ok: false,
      error: "Nom de modèle invalide (attendu : le nom publié sur ollama.com, ex. « gemma3:4b »).",
    };
  }

  const admin = createAdminClient();
  const { count } = await admin
    .schema("agents")
    .from("agents")
    .select("id", { count: "exact", head: true })
    .eq("model_provider", "ollama")
    .eq("model_id", name);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `${count} agent(s) utilisent encore le modèle « ${name} » : reconfigurez-les sur un autre modèle avant de supprimer celui-ci.`,
    };
  }

  try {
    await deleteModel(name);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "La suppression a échoué.",
    };
  }
  revalidatePath("/admin/providers");
  return { ok: true };
}
