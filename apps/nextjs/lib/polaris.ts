// Client de l'API Management Polaris (catalogue Iceberg, AGENTS.md §10).
// Polaris ne fait que du catalogue de métadonnées : la création/suppression
// des catalogues passe par cette API, jamais par écriture S3 directe.

const POLARIS_API_URL = process.env.POLARIS_API_URL ?? "http://localhost:8181";
const POLARIS_REALM = process.env.POLARIS_REALM ?? "POLARIS";
const CLIENT_ID = process.env.POLARIS_ROOT_CLIENT_ID ?? "root";
const CLIENT_SECRET = process.env.POLARIS_ROOT_CLIENT_SECRET ?? "";
const S3_BUCKET = process.env.POLARIS_S3_BUCKET ?? "parus-lakehouse";
const S3_ENDPOINT = process.env.POLARIS_S3_ENDPOINT ?? "http://rustfs:9000";
const S3_REGION = process.env.POLARIS_S3_REGION ?? "us-east-1";

// Catalogue par défaut de la plateforme : le catalogue système `parusdb`,
// créé au setup (apps/polaris/setup.sh) avant tout autre et **non
// supprimable** (garde UI + Server Action, spec §Data Lakehouse). Les
// catalogues d'environnement (dev, prod…) et créés par les utilisateurs
// sont ordinaires.
export const DEFAULT_CATALOG =
  process.env.POLARIS_SYSTEM_CATALOG ?? "parusdb";

export interface PolarisCatalog {
  name: string;
  type?: string;
  properties?: Record<string, string>;
  storageConfigInfo?: Record<string, unknown>;
  /** Version de l'entité (persistance) — requise pour le PUT (currentEntityVersion). */
  entityVersion?: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

// Jeton OAuth2 (client credentials, scope PRINCIPAL_ROLE:ALL) — même
// mécanisme que apps/polaris/setup.sh.
export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  if (!CLIENT_SECRET) {
    throw new Error(
      "POLARIS_ROOT_CLIENT_SECRET manquante : impossible d'appeler l'API Polaris.",
    );
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: "PRINCIPAL_ROLE:ALL",
  });
  const res = await fetch(`${POLARIS_API_URL}/api/catalog/v1/oauth/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `Polaris : échec de l'authentification OAuth2 (HTTP ${res.status}).`,
    );
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

async function management<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; status: number; data: T | null; raw: string }> {
  const token = await getAccessToken();
  const res = await fetch(`${POLARIS_API_URL}/api/management/v1${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Polaris-Realm": POLARIS_REALM,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const raw = await res.text();
  let data: T | null = null;
  try {
    data = raw ? (JSON.parse(raw) as T) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, raw };
}

export async function listCatalogs(): Promise<PolarisCatalog[]> {
  // Spec 1.8.0 : GET /management/v1/catalogs, réponse {catalogs: [...]}.
  const res = await management<{ catalogs?: PolarisCatalog[] }>("/catalogs");
  if (!res.ok) {
    throw new Error(
      `Polaris : impossible de lister les catalogues (HTTP ${res.status}).`,
    );
  }
  return res.data?.catalogs ?? [];
}

export async function getCatalog(
  name: string,
): Promise<PolarisCatalog | null> {
  // Vérifié sur Polaris 1.8.0 : GET /catalogs/{name} retourne l'objet
  // catalogue directement (pas d'enveloppe {catalog: ...}). Sans cette
  // lecture, ensureDefaultCatalogIsolated() voyait « catalogue absent » et
  // ne corrigeait jamais les allowedLocations du catalogue par défaut.
  const res = await management<PolarisCatalog | { catalog?: PolarisCatalog }>(
    `/catalogs/${encodeURIComponent(name)}`,
  );
  if (!res.ok || !res.data) return null;
  // Le GET direct retourne l'objet catalogue ; l'enveloppe éventuelle est
  // portée comme propriété optionnelle pour retomber sur l'objet lui-même.
  const data = res.data as PolarisCatalog & { catalog?: PolarisCatalog };
  return data.catalog ?? data;
}

// Crée un catalogue interne (même payload que apps/polaris/setup.sh :
// base location dédiée sous le bucket lakehouse, purge au DROP autorisée).
// allowedLocations est restreint au sous-répertoire du catalogue pour éviter
// tout chevauchement avec les autres catalogues (Polaris rejette la création
// si une location est préfixe d'une autre).
export async function createCatalog(
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const baseLocation = `s3://${S3_BUCKET}/${name}`;
  const payload = {
    catalog: {
      name,
      type: "INTERNAL",
      readOnly: false,
      properties: {
        "default-base-location": baseLocation,
        "polaris.config.drop-with-purge.enabled": "true",
      },
      storageConfigInfo: {
        storageType: "S3",
        allowedLocations: [baseLocation],
        endpoint: S3_ENDPOINT,
        endpointInternal: S3_ENDPOINT,
        pathStyleAccess: true,
        region: S3_REGION,
      },
    },
  };
  const res = await management("/catalogs", { method: "POST", body: payload });
  if (!res.ok && res.status !== 409) {
    return {
      ok: false,
      error: `La création du catalogue a échoué (HTTP ${res.status}) : ${res.raw.slice(0, 300)}`,
    };
  }
  // Grant d'administration au rôle catalog_admin du catalogue (piège
  // d'intégration documenté dans apps/polaris/README.md) — corps au format
  // AddGrantRequest {grant: GrantResource} de la spec Management.
  const grant = await management(
    `/catalogs/${encodeURIComponent(name)}/catalog-roles/catalog_admin/grants`,
    {
      method: "PUT",
      body: {
        grant: { type: "catalog", privilege: "CATALOG_MANAGE_CONTENT" },
      },
    },
  );
  if (!grant.ok) {
    return {
      ok: false,
      error: `Le grant CATALOG_MANAGE_CONTENT a échoué (HTTP ${grant.status}).`,
    };
  }
  return { ok: true };
}

// Met à jour la configuration storage d'un catalogue existant (PUT Management
// API). Utilisé pour corriger le catalogue par défaut créé avec
// allowedLocations = bucket entier (chevauchement avec les nouveaux
// catalogues isolés par sous-répertoire).
// `entityVersion` est OBLIGATOIRE dans le body (champ currentEntityVersion)
// : sans lui, Polaris rejette la mise à jour silencieusement.
export async function updateCatalogStorage(
  name: string,
  entityVersion: number,
  allowedLocations: string[],
): Promise<{ ok: boolean; error?: string }> {
  const payload = {
    currentEntityVersion: entityVersion,
    storageConfigInfo: {
      storageType: "S3",
      allowedLocations,
      endpoint: S3_ENDPOINT,
      endpointInternal: S3_ENDPOINT,
      pathStyleAccess: true,
      region: S3_REGION,
    },
  };
  const res = await management(`/catalogs/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: payload,
  });
  if (!res.ok) {
    return {
      ok: false,
      error: `La mise à jour du catalogue « ${name} » a échoué (HTTP ${res.status}) : ${res.raw.slice(0, 300)}`,
    };
  }
  return { ok: true };
}

// Vérifie que le catalogue par défaut a des allowedLocations restreints au
// sous-répertoire (et non au bucket entier). Si ce n'est pas le cas (install
// antérieure à l'isolation), le corrige automatiquement via l'API Management
// (PUT) — sinon tout nouveau catalogue serait rejeté par Polaris
// (chevauchement de locations, HTTP 400 ValidationException).
// Le flag n'est posé qu'après succès : un échec permettra un réessai.
// Retourne { fixed: true } si le catalogue a été corrigé (ou était déjà OK),
// { fixed: false, error } si la correction a échoué (Polaris injoignable ou
// API PUT rejetée).
let defaultCatalogFixed = false;
export async function ensureDefaultCatalogIsolated(): Promise<{
  fixed: boolean;
  error?: string;
}> {
  if (defaultCatalogFixed) return { fixed: true };
  try {
    const catalog = await getCatalog(DEFAULT_CATALOG);
    if (!catalog) return { fixed: true }; // Catalogue absent : rien à corriger
    const locations = (catalog.storageConfigInfo as Record<string, unknown> | undefined)
      ?.allowedLocations as string[] | undefined;
    // Si allowedLocations couvre le bucket entier (sans sous-répertoire),
    // restreindre au sous-répertoire du catalogue par défaut.
    const bucketRoot = `s3://${S3_BUCKET}`;
    const needsFix = locations?.some(
      (l) => l === bucketRoot || l === `${bucketRoot}/`,
    );
    if (!needsFix) {
      defaultCatalogFixed = true;
      return { fixed: true };
    }
    // entityVersion est requis par l'API PUT (currentEntityVersion) —
    // sans lui, Polaris rejette la mise à jour.
    if (catalog.entityVersion === undefined) {
      return {
        fixed: false,
        error: `entityVersion absent de la réponse GET pour « ${DEFAULT_CATALOG} » — impossible de corriger automatiquement.`,
      };
    }
    const result = await updateCatalogStorage(
      DEFAULT_CATALOG,
      catalog.entityVersion,
      [`s3://${S3_BUCKET}/${DEFAULT_CATALOG}`],
    );
    if (!result.ok) {
      return { fixed: false, error: result.error };
    }
    defaultCatalogFixed = true;
    return { fixed: true };
  } catch (error) {
    return {
      fixed: false,
      error: error instanceof Error ? error.message : "Erreur inattendue",
    };
  }
}

// Suppression d'un catalogue — spec 1.8.0 : DELETE /management/v1/catalogs/{name},
// le catalogue doit être vide. La purge des fichiers Iceberg est réalisée en
// amont via les DROP Trino (propriété polaris.config.drop-with-purge.enabled
// posée à la création) — voir deleteCatalogAction.
export async function deleteCatalog(
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await management(`/catalogs/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    return {
      ok: false,
      error: `La suppression du catalogue a échoué (HTTP ${res.status}) : ${res.raw.slice(0, 300)}`,
    };
  }
  return { ok: true };
}

export async function polarisPing(): Promise<boolean> {
  try {
    const res = await fetch(`${POLARIS_API_URL}/q/health`, {
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Utilisateurs applicatifs — principals Polaris (RBAC refonte,
// docs/functional/functional_specifications.md (§ Rôles et Permissions) §4). Endpoints validés sur Polaris 1.8.0 :
// le secret n'est JAMAIS stocké côté applicatif, il est retourné une seule
// fois à la création (POST /principals) ou à la réinitialisation
// (POST /principals/{name}/reset, réservé au client root ; /rotate est
// refusé pour root — bug #624, contourné par /reset).
// ---------------------------------------------------------------------------

export interface PolarisCredentials {
  clientId: string;
  clientSecret: string;
}

interface PrincipalWithCredentials {
  credentials?: PolarisCredentials;
}

// Privilèges Polaris couvrant chaque privilège ParusDB sur un catalogue.
// `manage` = CATALOG_MANAGE_CONTENT (englobe table/namespace + data).
export const CATALOG_GRANT_PRIVILEGES = {
  read: [
    "CATALOG_READ_PROPERTIES",
    "NAMESPACE_LIST",
    "NAMESPACE_READ_PROPERTIES",
    "TABLE_LIST",
    "TABLE_READ_PROPERTIES",
    "TABLE_READ_DATA",
  ],
  write: [
    "CATALOG_READ_PROPERTIES",
    "NAMESPACE_LIST",
    "NAMESPACE_READ_PROPERTIES",
    "NAMESPACE_CREATE",
    "NAMESPACE_WRITE_PROPERTIES",
    "TABLE_LIST",
    "TABLE_READ_PROPERTIES",
    "TABLE_CREATE",
    "TABLE_WRITE_PROPERTIES",
    "TABLE_READ_DATA",
    "TABLE_WRITE_DATA",
  ],
  manage: ["CATALOG_MANAGE_CONTENT"],
} as const;

export type ParusPrivilege = keyof typeof CATALOG_GRANT_PRIVILEGES;

// Privilèges Polaris effectifs pour un ensemble de privilèges ParusDB.
export function polarisCatalogPrivileges(
  privileges: ParusPrivilege[],
): string[] {
  const set = new Set<string>();
  for (const p of privileges) {
    for (const pol of CATALOG_GRANT_PRIVILEGES[p]) set.add(pol);
  }
  return [...set];
}

export async function createPolarisPrincipal(
  name: string,
): Promise<PolarisCredentials> {
  const res = await management<PrincipalWithCredentials>("/principals", {
    method: "POST",
    body: { principal: { name, type: "SERVICE", properties: {} } },
  });
  if (!res.ok || !res.data?.credentials) {
    if (res.status === 409) {
      throw new Error(
        `Un principal Polaris nommé « ${name} » existe déjà.`,
      );
    }
    throw new Error(
      `La création du compte applicatif Polaris a échoué (HTTP ${res.status}) : ${res.raw.slice(0, 300)}`,
    );
  }
  return res.data.credentials;
}

// Nouveau secret (l'ancien est invalidé). Le clientId reste inchangé —
// seul le clientSecret est régénéré.
export async function resetPolarisCredentials(
  name: string,
): Promise<PolarisCredentials> {
  const res = await management<PrincipalWithCredentials>(
    `/principals/${encodeURIComponent(name)}/reset`,
    { method: "POST", body: {} },
  );
  if (!res.ok || !res.data?.credentials) {
    throw new Error(
      `La réinitialisation des credentials a échoué (HTTP ${res.status}) : ${res.raw.slice(0, 300)}`,
    );
  }
  return res.data.credentials;
}

export async function deletePolarisPrincipal(name: string): Promise<void> {
  const res = await management(`/principals/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  // 404 : principal déjà absent — suppression idempotente.
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `La suppression du principal Polaris a échoué (HTTP ${res.status}) : ${res.raw.slice(0, 300)}`,
    );
  }
}

async function ensurePrincipalRole(name: string): Promise<void> {
  const res = await management("/principal-roles", {
    method: "POST",
    body: { principalRole: { name, properties: {} } },
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(
      `La création du rôle Polaris « ${name} » a échoué (HTTP ${res.status}) : ${res.raw.slice(0, 300)}`,
    );
  }
}

export async function assignPrincipalRole(
  principal: string,
  principalRole: string,
): Promise<void> {
  const res = await management(
    `/principals/${encodeURIComponent(principal)}/principal-roles`,
    { method: "PUT", body: { principalRole: { name: principalRole } } },
  );
  if (!res.ok && res.status !== 201 && res.status !== 200) {
    throw new Error(
      `L'attribution du rôle « ${principalRole} » au compte applicatif a échoué (HTTP ${res.status}).`,
    );
  }
}

export async function revokePrincipalRole(
  principal: string,
  principalRole: string,
): Promise<void> {
  const res = await management(
    `/principals/${encodeURIComponent(principal)}/principal-roles/${encodeURIComponent(principalRole)}`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `Le retrait du rôle « ${principalRole} » a échoué (HTTP ${res.status}).`,
    );
  }
}

// Nom du catalog-role dédié au miroir d'un rôle ParusDB dans un catalogue.
export function mirrorCatalogRoleName(roleKey: string): string {
  return `${roleKey}_access`;
}

async function ensureCatalogRole(
  catalog: string,
  catalogRole: string,
): Promise<void> {
  const res = await management(
    `/catalogs/${encodeURIComponent(catalog)}/catalog-roles`,
    { method: "POST", body: { catalogRole: { name: catalogRole, properties: {} } } },
  );
  if (!res.ok && res.status !== 409) {
    throw new Error(
      `La création du rôle de catalogue « ${catalogRole} » a échoué (HTTP ${res.status}) : ${res.raw.slice(0, 300)}`,
    );
  }
}

// Alignement des grants d'un catalog-role sur un ensemble de privilèges
// Polaris (PUT par privilège à ajouter, POST = révocation d'un privilège).
async function setCatalogRoleGrants(
  catalog: string,
  catalogRole: string,
  privileges: string[],
): Promise<void> {
  const res = await management<{ grants?: { privilege?: string }[] }>(
    `/catalogs/${encodeURIComponent(catalog)}/catalog-roles/${encodeURIComponent(catalogRole)}/grants`,
  );
  if (!res.ok) {
    throw new Error(
      `La lecture des grants Polaris a échoué (HTTP ${res.status}).`,
    );
  }
  const current = new Set(
    (res.data?.grants ?? [])
      .map((g) => g.privilege)
      .filter((p): p is string => Boolean(p)),
  );
  for (const privilege of privileges) {
    if (!current.has(privilege)) {
      const add = await management(
        `/catalogs/${encodeURIComponent(catalog)}/catalog-roles/${encodeURIComponent(catalogRole)}/grants`,
        { method: "PUT", body: { grant: { type: "catalog", privilege } } },
      );
      if (!add.ok) {
        throw new Error(
          `L'attribution du privilège ${privilege} a échoué (HTTP ${add.status}).`,
        );
      }
      current.add(privilege);
    }
  }
  for (const privilege of [...current]) {
    if (!privileges.includes(privilege)) {
      const revoke = await management(
        `/catalogs/${encodeURIComponent(catalog)}/catalog-roles/${encodeURIComponent(catalogRole)}/grants`,
        { method: "POST", body: { grant: { type: "catalog", privilege } } },
      );
      if (!revoke.ok) {
        throw new Error(
          `La révocation du privilège ${privilege} a échoué (HTTP ${revoke.status}).`,
        );
      }
    }
  }
}

async function assignCatalogRoleToPrincipalRole(
  principalRole: string,
  catalog: string,
  catalogRole: string,
): Promise<void> {
  const res = await management(
    `/principal-roles/${encodeURIComponent(principalRole)}/catalog-roles/${encodeURIComponent(catalog)}`,
    { method: "PUT", body: { catalogRole: { name: catalogRole } } },
  );
  if (!res.ok && res.status !== 201 && res.status !== 200) {
    throw new Error(
      `L'attribution du rôle de catalogue sur « ${catalog} » a échoué (HTTP ${res.status}).`,
    );
  }
}

async function revokeCatalogRoleFromPrincipalRole(
  principalRole: string,
  catalog: string,
  catalogRole: string,
): Promise<void> {
  const res = await management(
    `/principal-roles/${encodeURIComponent(principalRole)}/catalog-roles/${encodeURIComponent(catalog)}/${encodeURIComponent(catalogRole)}`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 404 && res.status !== 204) {
    throw new Error(
      `Le retrait du rôle de catalogue sur « ${catalog} » a échoué (HTTP ${res.status}).`,
    );
  }
}

// Miroir complet de l'accès aux catalogues pour un rôle ParusDB : un
// catalog-role dédié par catalogue porte les privilèges Polaris issus des
// grants du rôle (iam.grants, resource_type 'catalog'), assigné au
// principal-role portant le nom du rôle. Tous les principals Polaris avec ce
// rôle en bénéficient. Les catalogues sans grant sont retirés.
export async function syncRoleCatalogAccess(input: {
  roleKey: string;
  catalogGrants: { catalog: string; privileges: ParusPrivilege[] }[];
}): Promise<{ ok: boolean; error?: string }> {
  const catalogRole = mirrorCatalogRoleName(input.roleKey);
  const desired = new Map(
    input.catalogGrants.map((g) => [g.catalog, g.privileges]),
  );
  try {
    await ensurePrincipalRole(input.roleKey);
    // L'ensemble des catalogues réels couvre les ajouts ET les retraits.
    const catalogs = await listCatalogs();
    for (const catalog of catalogs) {
      const privileges = desired.get(catalog.name);
      if (privileges && privileges.length > 0) {
        await ensureCatalogRole(catalog.name, catalogRole);
        await setCatalogRoleGrants(
          catalog.name,
          catalogRole,
          polarisCatalogPrivileges(privileges),
        );
        await assignCatalogRoleToPrincipalRole(
          input.roleKey,
          catalog.name,
          catalogRole,
        );
      } else {
        await revokeCatalogRoleFromPrincipalRole(
          input.roleKey,
          catalog.name,
          catalogRole,
        );
      }
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "La synchronisation Polaris a échoué.",
    };
  }
}
