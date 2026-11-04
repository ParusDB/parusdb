// Informations de connexion du lakehouse pour les outils data externes
// (spec fonctionnelle § « Rôles et Permissions »). Adresses publiques : le hostname des URLs internes
// (ex. http://rustfs:9000, interne au réseau Docker) est remplacé par
// PARUSDB_PUBLIC_HOST (défaut : localhost) - ports et chemins conservés.

export interface ConnectionEndpoints {
  trinoUrl: string;
  trinoHost: string;
  trinoPort: string;
  polarisUrl: string;
  polarisRestUri: string;
  polarisTokenUri: string;
  s3Endpoint: string;
  s3Bucket: string;
  s3Region: string;
}

// Hostname public : override explicite, sinon le hostname effectif des URLs
// internes si le stack est déjà exposé autrement qu'en localhost, sinon
// localhost.
function publicHostname(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return parsed.hostname;
    }
  } catch {
    // URL inexploitable : retomber sur localhost.
  }
  return "localhost";
}

function publicize(rawUrl: string, host: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hostname = host;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return rawUrl;
  }
}

export function getConnectionEndpoints(): ConnectionEndpoints {
  const trinoInternal = process.env.TRINO_URL ?? "http://localhost:8080";
  const polarisInternal = process.env.POLARIS_API_URL ?? "http://localhost:8181";
  const s3Internal = process.env.POLARIS_S3_ENDPOINT ?? "http://rustfs:9000";
  const publicHost =
    process.env.PARUSDB_PUBLIC_HOST?.trim() ||
    publicHostname(trinoInternal);

  const trinoUrl = publicize(trinoInternal, publicHost);
  const polarisUrl = publicize(polarisInternal, publicHost);
  const s3Endpoint = publicize(s3Internal, publicHost);

  const trinoParsed = new URL(trinoUrl);
  return {
    trinoUrl,
    trinoHost: trinoParsed.hostname,
    trinoPort: trinoParsed.port || "8080",
    polarisUrl,
    polarisRestUri: `${polarisUrl}/api/catalog`,
    polarisTokenUri: `${polarisUrl}/api/catalog/v1/oauth/tokens`,
    s3Endpoint,
    s3Bucket: process.env.POLARIS_S3_BUCKET ?? "parus-lakehouse",
    s3Region: process.env.POLARIS_S3_REGION ?? "us-east-1",
  };
}

// Clés S3 (RustFS) : nécessaires aux outils qui écrivent directement dans
// l'object storage (Airbyte) - Polaris vends des credentials temporaires aux
// clients Iceberg REST (Spark, Flink, pyiceberg), pas aux connecteurs S3.
export function getS3Keys(): {
  accessKeyId: string;
  secretAccessKey: string;
} | null {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) return null;
  return { accessKeyId, secretAccessKey };
}
