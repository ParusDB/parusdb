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
