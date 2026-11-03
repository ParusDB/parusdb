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
import {
  assignPrincipalRole,
  createPolarisPrincipal,
  deletePolarisPrincipal,
  resetPolarisCredentials,
  revokePrincipalRole,
  syncRoleCatalogAccess,
  type ParusPrivilege,
} from "@/lib/polaris";
import {
  ensureRoleTrinoAccounts,
  generateTrinoPassword,
  isReservedTrinoUserName,
  removeTrinoPassword,
  syncTrinoRules,
  upsertTrinoPassword,
} from "@/lib/trino-security";

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
// Utilisateurs applicatifs (comptes service pour les outils data : dbt,
// Power BI, Airbyte… — spec fonctionnelle § « Rôles et Permissions »/§4). Credentials Polaris
// affichées UNE FOIS : jamais stockées côté applicatif.
// ---------------------------------------------------------------------------

const APP_USER_NAME_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;

export interface AppUserCredentials {
  clientId: string;
  clientSecret: string;
  /** Mot de passe Trino (HTTPS + basic auth) : affiché une seule fois. */
  trinoPassword?: string;
}

// Droits de catalogue actuels d'un rôle, pour le miroir Polaris.
async function roleCatalogGrants(
  admin: ReturnType<typeof createAdminClient>,
  roleId: string,
): Promise<{ catalog: string; privileges: ParusPrivilege[] }[]> {
  const { data } = await admin
    .schema("iam")
    .from("grants")
    .select("resource_id, privileges")
    .eq("role_id", roleId)
    .eq("resource_type", "catalog");
  return (data ?? []).map(
    (g: { resource_id: string; privileges: ParusPrivilege[] }) => ({
      catalog: g.resource_id,
      privileges: g.privileges,
    }),
  );
}

export async function createAppUser(input: {
  name: string;
  note: string;
  roleId: string;
}): Promise<{
  ok: boolean;
  error?: string;
  warning?: string;
  credentials?: AppUserCredentials;
}> {
  const session = await requireAdmin();
  const admin = createAdminClient();
  const name = input.name.trim().toLowerCase();
  if (!APP_USER_NAME_PATTERN.test(name)) {
    return {
      ok: false,
      error:
        "Nom invalide : minuscules, chiffres et tirets, 3 caractères minimum (ex. airbyte-prod).",
    };
  }
  if (isReservedTrinoUserName(name)) {
    return {
      ok: false,
      error:
        "Ce nom est réservé (comptes de service Trino : BFF, mcp-trino, préfixe parus-role- des comptes de rôle).",
    };
  }
  const { data: role } = await admin
    .schema("iam")
    .from("roles")
    .select("id, key, is_system")
    .eq("id", input.roleId)
    .maybeSingle();
  if (!role) {
    return { ok: false, error: "Rôle introuvable." };
  }
  if (role.key === "admin") {
    return {
      ok: false,
      error:
        "Le rôle admin hérite de tout sans grants explicites : choisissez un rôle avec des droits distribués via /admin/roles.",
    };
  }

  // 1-4. Principal Polaris + rôles + miroir des grants de catalogue du rôle.
  let credentials: AppUserCredentials;
  try {
    credentials = await createPolarisPrincipal(name);
    const sync = await syncRoleCatalogAccess({
      roleKey: role.key,
      catalogGrants: await roleCatalogGrants(admin, role.id),
    });
    if (!sync.ok) {
      // Le principal est créé : le nettoyer pour rester cohérent.
      await deletePolarisPrincipal(name).catch(() => undefined);
      return {
        ok: false,
        error: `Le miroir Polaris a échoué : ${sync.error}`,
      };
    }
    // Le principal porte le principal-role nommé comme le rôle ParusDB.
    await assignPrincipalRole(name, role.key);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "La création a échoué.",
    };
  }

  // 5. Registre applicatif (clientId seulement — jamais le secret).
  const { error: insertError } = await admin
    .schema("iam")
    .from("app_users")
    .insert({
      name,
      note: input.note.trim() || null,
      role_id: role.id,
      polaris_client_id: credentials.clientId,
      credentials_rotated_at: new Date().toISOString(),
      created_by: session.userId,
    });
  if (insertError) {
    await deletePolarisPrincipal(name).catch(() => undefined);
    if (insertError.code === "23505") {
      return {
        ok: false,
        error: `Un utilisateur applicatif nommé « ${name} » existe déjà.`,
      };
    }
    return { ok: false, error: `L'enregistrement a échoué : ${insertError.message}` };
  }

  // 6. Durcissement Trino (spec fonctionnelle § « Intégration Technique » (durcissement Trino).2) : mot de passe Trino du
  // compte applicatif (affiché une seule fois, comme le clientSecret) +
  // règles d'access control régénérées. Best effort : un échec n'annule pas
  // la création (le compte reste utilisable via Polaris REST), il est
  // renvoyé en avertissement.
  const trinoPassword = generateTrinoPassword();
  let warning: string | undefined;
  const passwordSync = await upsertTrinoPassword(name, trinoPassword);
  const rulesSync = await syncTrinoRules();
  if (!passwordSync.ok || !rulesSync.ok) {
    warning =
      "Compte créé, mais le durcissement Trino a échoué " +
      `(${passwordSync.error ?? rulesSync.error}) : la connexion Trino du ` +
      "compte ne sera pas utilisable tant que TRINO_SECURITY_DIR n'est pas " +
      "corrigé (réinitialisez alors les credentials).";
  }
  credentials.trinoPassword = trinoPassword;

  revalidatePath("/admin/users");
  return { ok: true, credentials, warning };
}

// Réinitialisation : nouveaux secrets Polaris ET Trino (rotés ensemble,
// même parcours — spec fonctionnelle § « Intégration Technique » (durcissement Trino).2), retournés une seule fois. Le
// clientId reste inchangé.
export async function rotateAppUserCredentials(
  appUserId: string,
): Promise<{
  ok: boolean;
  error?: string;
  warning?: string;
  credentials?: AppUserCredentials;
}> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data: appUser } = await admin
    .schema("iam")
    .from("app_users")
    .select("name")
    .eq("id", appUserId)
    .maybeSingle();
  if (!appUser) {
    return { ok: false, error: "Utilisateur applicatif introuvable." };
  }
  try {
    const credentials: AppUserCredentials = await resetPolarisCredentials(appUser.name);
    const { error } = await admin
      .schema("iam")
      .from("app_users")
      .update({ credentials_rotated_at: new Date().toISOString() })
      .eq("id", appUserId);
    if (error) {
      return { ok: false, error: `La mise à jour a échoué : ${error.message}` };
    }
    // Mot de passe Trino régénéré avec le secret Polaris.
    const trinoPassword = generateTrinoPassword();
    const passwordSync = await upsertTrinoPassword(appUser.name, trinoPassword);
    let warning: string | undefined;
    if (!passwordSync.ok) {
      warning = `Secrets Polaris régénérés, mais le mot de passe Trino n'a pas pu être mis à jour (${passwordSync.error}).`;
    } else {
      credentials.trinoPassword = trinoPassword;
    }
    revalidatePath("/admin/users");
    return { ok: true, credentials, warning };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "La réinitialisation a échoué.",
    };
  }
}

// Changement de rôle : réassignation du principal-role Polaris + resync des
// accès catalogue + régénération des règles Trino (durcissement).
export async function updateAppUserRole(
  appUserId: string,
  roleId: string,
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  const [{ data: appUser }, { data: role }] = await Promise.all([
    admin
      .schema("iam")
      .from("app_users")
      .select("name, role_id")
      .eq("id", appUserId)
      .maybeSingle(),
    admin
      .schema("iam")
      .from("roles")
      .select("id, key")
      .eq("id", roleId)
      .maybeSingle(),
  ]);
  if (!appUser || !role) {
    return { ok: false, error: "Utilisateur applicatif ou rôle introuvable." };
  }
  if (role.key === "admin") {
    return {
      ok: false,
      error:
        "Le rôle admin hérite de tout sans grants explicites : choisissez un rôle avec des droits distribués via /admin/roles.",
    };
  }
  if (appUser.role_id === role.id) return { ok: true };

  // Rôle Polaris de l'ancien rôle ParusDB (pour le retrait).
  const { data: previousRole } = await admin
    .schema("iam")
    .from("roles")
    .select("key")
    .eq("id", appUser.role_id)
    .maybeSingle();

  try {
    if (previousRole) {
      await revokePrincipalRole(appUser.name, previousRole.key);
    }
    const sync = await syncRoleCatalogAccess({
      roleKey: role.key,
      catalogGrants: await roleCatalogGrants(admin, role.id),
    });
    if (!sync.ok) {
      return { ok: false, error: `Le miroir Polaris a échoué : ${sync.error}` };
    }
    await assignPrincipalRole(appUser.name, role.key);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "La mise à jour a échoué.",
    };
  }
  const { error } = await admin
    .schema("iam")
    .from("app_users")
    .update({ role_id: role.id })
    .eq("id", appUserId);
  if (error) {
    return { ok: false, error: `La mise à jour a échoué : ${error.message}` };
  }
  // Règles d'access control Trino : elles suivent les grants du nouveau rôle
  // (best effort, cf. miroir Polaris).
  const trinoSync = await syncTrinoRules();
  revalidatePath("/admin/users");
  if (!trinoSync.ok) {
    return {
      ok: true,
      warning: `Rôle mis à jour, mais la régénération des règles Trino a échoué : ${trinoSync.error}`,
    };
  }
  return { ok: true };
}

export async function deleteAppUser(
  appUserId: string,
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data: appUser } = await admin
    .schema("iam")
    .from("app_users")
    .select("name")
    .eq("id", appUserId)
    .maybeSingle();
  if (!appUser) {
    return { ok: false, error: "Utilisateur applicatif introuvable." };
  }
  try {
    await deletePolarisPrincipal(appUser.name);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "La suppression Polaris a échoué.",
    };
  }
  const { error } = await admin
    .schema("iam")
    .from("app_users")
    .delete()
    .eq("id", appUserId);
  if (error) {
    return { ok: false, error: `La suppression a échoué : ${error.message}` };
  }
  // Révocation immédiate côté Trino : retrait de la ligne bcrypt (refresh
  // 5 s) + règles régénérées (best effort).
  const passwordSync = await removeTrinoPassword(appUser.name);
  const rulesSync = await syncTrinoRules();
  revalidatePath("/admin/users");
  if (!passwordSync.ok || !rulesSync.ok) {
    return {
      ok: true,
      warning:
        "Compte supprimé, mais la révocation Trino a échoué " +
        `(${passwordSync.error ?? rulesSync.error}) : vérifiez TRINO_SECURITY_DIR.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rôles (spec §Administration — Rôles)
// ---------------------------------------------------------------------------

export async function createRole(input: {
  key: string;
  name: string;
  description: string;
}): Promise<{ ok: boolean; error?: string; warning?: string }> {
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
  // Durcissement Trino : le nouveau rôle reçoit son compte parus-role-<id>
  // (inert : allow:none tant qu'aucun grant) + rules.json resynchronisé
  // (best effort, même parcours que les grants).
  const accounts = await ensureRoleTrinoAccounts();
  const rules = accounts.ok ? await syncTrinoRules() : accounts;
  revalidatePath("/admin/roles");
  if (!rules.ok) {
    return {
      ok: true,
      warning: `Rôle créé, mais le durcissement Trino a échoué (${rules.error}) : l'éditeur SQL de ce rôle ne fonctionnera pas tant que TRINO_SECURITY_DIR n'est pas corrigé.`,
    };
  }
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
): Promise<{ ok: boolean; error?: string; warning?: string }> {
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
  // Durcissement Trino : la ligne SQL du compte de rôle est cascade-
  // détruite ; retirer la ligne bcrypt + resynchroniser rules.json (best
  // effort — révocation effective après refresh 5 s).
  const accounts = await ensureRoleTrinoAccounts();
  const rules = accounts.ok ? await syncTrinoRules() : accounts;
  revalidatePath("/admin/roles");
  if (!rules.ok) {
    return {
      ok: true,
      warning: `Rôle supprimé, mais la révocation Trino a échoué (${rules.error}) : vérifiez TRINO_SECURITY_DIR.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Grants RBAC (docs/functional/functional_specifications.md (§ Rôles et Permissions)) : l'admin distribue les
// privilèges read/write/manage par rôle sur les catalogues, agents et
// pipelines. La hiérarchie (manage ⊇ write ⊇ read) est appliquée au moment
// de l'enregistrement : un privilège supérieur inclut toujours les
// inférieurs.
// ---------------------------------------------------------------------------

export type GrantPrivilege = "read" | "write" | "manage";
export type GrantResourceType = "catalog" | "agent" | "pipeline";

const GRANT_PRIVILEGES: GrantPrivilege[] = ["read", "write", "manage"];
const GRANT_RESOURCE_TYPES: GrantResourceType[] = ["catalog", "agent", "pipeline"];

// Complète l'ensemble des privilèges selon la hiérarchie.
function expandPrivileges(privileges: GrantPrivilege[]): GrantPrivilege[] {
  const set = new Set(privileges);
  if (set.has("manage")) {
    set.add("write");
  }
  if (set.has("write")) {
    set.add("read");
  }
  return GRANT_PRIVILEGES.filter((p) => set.has(p));
}

// L'objet référencé doit exister au moment de l'attribution.
async function resourceExists(
  admin: ReturnType<typeof createAdminClient>,
  resourceType: GrantResourceType,
  resourceId: string,
): Promise<boolean> {
  if (resourceType === "catalog") {
    const { count } = await admin
      .schema("lakehouse")
      .from("catalog_registry")
      .select("catalog_name", { count: "exact", head: true })
      .eq("catalog_name", resourceId);
    return (count ?? 0) > 0;
  }
  if (resourceType === "agent") {
    const { count } = await admin
      .schema("agents")
      .from("agents")
      .select("id", { count: "exact", head: true })
      .eq("id", resourceId);
    return (count ?? 0) > 0;
  }
  const { count } = await admin
    .schema("connectors")
    .from("pipelines")
    .select("id", { count: "exact", head: true })
    .eq("id", resourceId);
  return (count ?? 0) > 0;
}

export async function setRoleGrant(input: {
  roleId: string;
  resourceType: GrantResourceType;
  resourceId: string;
  privileges: GrantPrivilege[];
}): Promise<{ ok: boolean; error?: string; warning?: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  if (!GRANT_RESOURCE_TYPES.includes(input.resourceType)) {
    return { ok: false, error: "Type de ressource inconnu." };
  }
  const valid = input.privileges.filter((p) =>
    GRANT_PRIVILEGES.includes(p),
  );
  if (valid.length !== input.privileges.length) {
    return { ok: false, error: "Privilège inconnu." };
  }
  const privileges = expandPrivileges(valid);
  if (privileges.length === 0) {
    const { error } = await admin
      .schema("iam")
      .from("grants")
      .delete()
      .eq("role_id", input.roleId)
      .eq("resource_type", input.resourceType)
      .eq("resource_id", input.resourceId);
    if (error) {
      return { ok: false, error: `La révocation a échoué : ${error.message}` };
    }
  } else {
    if (!(await resourceExists(admin, input.resourceType, input.resourceId))) {
      return { ok: false, error: "La ressource visée n'existe plus." };
    }
    const { error } = await admin
      .schema("iam")
      .from("grants")
      .upsert(
        {
          role_id: input.roleId,
          resource_type: input.resourceType,
          resource_id: input.resourceId,
          privileges,
        },
        { onConflict: "role_id,resource_type,resource_id" },
      );
    if (error) {
      return { ok: false, error: `L'enregistrement a échoué : ${error.message}` };
    }
  }
  // Miroir Polaris (comptes applicatifs du rôle) : best effort — un échec
  // est renvoyé en avertissement sans bloquer l'édition applicative
  // (synchronisation éventuellement cohérente, spec fonctionnelle § « Rôles et Permissions »).
  let warning: string | undefined;
  if (input.resourceType === "catalog") {
    const sync = await mirrorRoleCatalogAccess(input.roleId);
    if (!sync.ok) {
      warning = `Droit enregistré, mais la synchronisation Polaris a échoué : ${sync.error}`;
    }
    // Durcissement Trino : rules.json régénéré depuis iam.grants (source de
    // vérité unique) — refus effectif sur le chemin Trino (dbt, Power BI,
    // JDBC) après refresh (5 s), sans redémarrage. Best effort identique.
    const trinoSync = await syncTrinoRules();
    if (!trinoSync.ok) {
      const msg = `Droit enregistré, mais la régénération des règles Trino a échoué : ${trinoSync.error}`;
      warning = warning ? `${warning} ${msg}` : msg;
    }
  }
  revalidatePath("/admin/roles");
  if (warning) return { ok: true, warning };
  return { ok: true };
}

// Rejoue le miroir Polaris d'un rôle : ne touche Polaris que si des
// utilisateurs applicatifs portent ce rôle.
async function mirrorRoleCatalogAccess(
  roleId: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const [{ data: role }, { count: appUserCount }, { data: grants }] =
    await Promise.all([
      admin.schema("iam").from("roles").select("key").eq("id", roleId).maybeSingle(),
      admin
        .schema("iam")
        .from("app_users")
        .select("id", { count: "exact", head: true })
        .eq("role_id", roleId),
      admin
        .schema("iam")
        .from("grants")
        .select("resource_id, privileges")
        .eq("role_id", roleId)
        .eq("resource_type", "catalog"),
    ]);
  if ((appUserCount ?? 0) === 0 || !role) return { ok: true };
  const catalogGrants = (grants ?? []).map(
    (g: { resource_id: string; privileges: ParusPrivilege[] }) => ({
      catalog: g.resource_id,
      privileges: g.privileges,
    }),
  );
  return syncRoleCatalogAccess({ roleKey: role.key, catalogGrants });
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
