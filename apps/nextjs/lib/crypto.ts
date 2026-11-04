import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

// Chiffrement AES-256-GCM des credentials (clés API LLM, credentials de
// connecteurs) : chiffrés au repos, jamais renvoyés au client ni loggés
// (AGENTS.md §11 et §12).

function getKey(): Buffer {
  const secret = process.env.PARUSDB_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error(
      "PARUSDB_ENCRYPTION_KEY manquante ou trop courte (attendu : openssl rand -hex 32).",
    );
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return Buffer.concat([iv, encrypted]).toString("base64");
}

export function decryptSecret(blob: string): string {
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const data = raw.subarray(12, raw.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

// Masque lisible en UI : jamais le secret lui-même.
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 8) return "••••••••";
  return `${plaintext.slice(0, 4)}${"•".repeat(8)}${plaintext.slice(-4)}`;
}
