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

export const DEFAULT_CATALOG =
  process.env.POLARIS_DEFAULT_CATALOG ?? "dev";

export interface PolarisCatalog {
  name: string;
  type?: string;
  properties?: Record<string, string>;
  storageConfigInfo?: Record<string, unknown>;
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
  const res = await management<{ catalogs?: PolarisCatalog[] }>(
    "/catalogs?pageSize=100",
  );
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
  const res = await management<PolarisCatalog>(`/catalogs/${encodeURIComponent(name)}`);
  return res.ok ? res.data : null;
}

// Crée un catalogue interne (même payload que apps/polaris/setup.sh :
// base location dédiée sous le bucket lakehouse, purge au DROP autorisée).
export async function createCatalog(
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const payload = {
    catalog: {
      name,
      type: "INTERNAL",
      readOnly: false,
      properties: {
        "default-base-location": `s3://${S3_BUCKET}/${name}`,
        "polaris.config.drop-with-purge.enabled": "true",
      },
      storageConfigInfo: {
        storageType: "S3",
        allowedLocations: [`s3://${S3_BUCKET}`],
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
  // d'intégration documenté dans apps/polaris/README.md).
  const grant = await management(
    `/catalogs/${encodeURIComponent(name)}/catalog-roles/catalog_admin/grants`,
    {
      method: "PUT",
      body: { type: "catalog", privilege: "CATALOG_MANAGE_CONTENT" },
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

// Suppression avec purge (fichiers Iceberg inclus) — action irréversible,
// réservée à la confirmation admin avec ressaisie du nom.
export async function deleteCatalog(
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await management(
    `/catalogs/${encodeURIComponent(name)}?purgeRequested=true`,
    { method: "DELETE" },
  );
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
