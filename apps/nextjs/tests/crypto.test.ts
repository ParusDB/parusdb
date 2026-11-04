import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
} from "@/lib/crypto";

// Chiffrement des credentials/clés API (AES-256-GCM, AGENTS.md §11/§12) :
// le format du blob doit rester compatible avec le runner dlt
// (apps/dlt/runner/crypto.py : base64(iv[12] || cipher || tag[16])).
const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);

describe("encryptSecret / decryptSecret", () => {
  it("fait un aller-retour byte-à-byte", () => {
    process.env.PARUSDB_ENCRYPTION_KEY = KEY;
    const secret = '{"host":"db","password":"p@ss\'wor\"d"}';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("produit un blob non déterministe (iv aléatoire) et opaque", () => {
    process.env.PARUSDB_ENCRYPTION_KEY = KEY;
    const secret = "le-meme-secret";
    const blob1 = encryptSecret(secret);
    const blob2 = encryptSecret(secret);
    expect(blob1).not.toBe(blob2);
    expect(blob1).not.toContain(secret);
    // Format : 12 octets d'iv + contenu + 16 octets de tag, en base64.
    const raw = Buffer.from(blob1, "base64");
    expect(raw.length).toBeGreaterThanOrEqual(12 + secret.length + 16);
  });

  it("refuse de déchiffrer avec une autre clé", () => {
    process.env.PARUSDB_ENCRYPTION_KEY = KEY;
    const blob = encryptSecret("secret");
    process.env.PARUSDB_ENCRYPTION_KEY = OTHER_KEY;
    expect(() => decryptSecret(blob)).toThrow();
    delete process.env.PARUSDB_ENCRYPTION_KEY;
  });
});

describe("maskSecret", () => {
  it("masque le milieu, garde les extrémités", () => {
    expect(maskSecret("0123456789")).toBe("0123••••••••6789");
  });

  it("masque entièrement les secrets courts sans rien révéler", () => {
    expect(maskSecret("court")).toBe("••••••••");
    expect(maskSecret("")).toBe("••••••••");
  });
});
