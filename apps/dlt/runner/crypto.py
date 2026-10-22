"""Chiffrement compatible avec apps/nextjs/lib/crypto.ts (AES-256-GCM).

Format stocké dans connectors.pipelines.credentials_encrypted :
    base64( iv[12] || ciphertext || tag[16] )
Clé dérivée : sha256(PARUSDB_ENCRYPTION_KEY) — même construction que le BFF
Next.js, qui chiffre à l'enregistrement du pipeline.
"""

import base64
import hashlib

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class DecryptionError(Exception):
    """Clé de chiffrement invalide ou credentials corrompus."""


def derive_key(secret: str) -> bytes:
    return hashlib.sha256(secret.encode("utf-8")).digest()


def decrypt_secret(blob: str, secret: str) -> str:
    """Déchiffre un secret produit par lib/crypto.ts côté Next.js."""
    try:
        raw = base64.b64decode(blob)
        if len(raw) < 12 + 16:
            raise ValueError("blob trop court")
        iv = raw[:12]
        tag = raw[-16:]
        ciphertext = raw[12:-16]
        plain = AESGCM(derive_key(secret)).decrypt(iv, ciphertext + tag, None)
        return plain.decode("utf-8")
    except (ValueError, InvalidTag) as exc:
        raise DecryptionError(
            "impossible de déchiffrer les credentials du pipeline : la clé "
            "PARUSDB_ENCRYPTION_KEY de apps/dlt/.env doit être identique à celle "
            "de apps/nextjs/.env.local"
        ) from exc
