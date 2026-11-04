#!/usr/bin/env python3
"""Génération des INSERT des deux pipelines ELT de test (demo Postgres +
demo Kafka). Credentials chiffrés AES-256-GCM au format exact de
apps/nextjs/lib/crypto.ts : base64(iv[12] || ciphertext || tag[16]),
clé = sha256(PARUSDB_ENCRYPTION_KEY) lue dans apps/dlt/.env (jamais affichée)."""

import base64
import hashlib
import json
import os
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# Propriétaire des pipelines : compte administrateur local (premier compte
# créé), surchargé par --owner (e2e CI, fixtures à uuid fixe).
DEFAULT_OWNER_ID = "ece294c5-ff6e-4f58-b430-6660eb8f499d"

DEMO = os.path.dirname(os.path.abspath(__file__))
ENV_PATHS = [
    os.path.join(DEMO, "..", ".env"),
    "/home/gbalthazar/GIT/parusdb/apps/dlt/.env",
]


def read_key() -> bytes:
    for path in ENV_PATHS:
        try:
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("PARUSDB_ENCRYPTION_KEY="):
                        secret = line.split("=", 1)[1].strip()
                        if len(secret) < 32:
                            raise SystemExit("clé trop courte")
                        return hashlib.sha256(secret.encode()).digest()
        except FileNotFoundError:
            continue
    raise SystemExit("PARUSDB_ENCRYPTION_KEY introuvable")


def encrypt_secret(plaintext: str, key: bytes) -> str:
    iv = os.urandom(12)
    aes = AESGCM(key)
    blob = iv + aes.encrypt(iv, plaintext.encode(), None)
    return base64.b64encode(blob).decode()


def lit(value) -> str:
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    if isinstance(value, list):
        return "ARRAY[" + ",".join(lit(v) for v in value) + "]"
    return "'" + json.dumps(value).replace("'", "''") + "'"


PIPELINES = [
    {
        "name": "demo-pg-sales",
        "source_type": "postgresql",
        "source_config": {"cursors": {"customers": "updated_at", "orders": "updated_at"}},
        "creds": {
            "host": "parus-dlt-demo-postgres",
            "port": 5432,
            "database": "demo_sales",
            "username": "demo",
            "password": "demo",
        },
        "tables": ["customers", "orders"],
        "write_mode": "incremental",
        "destination_schema": "ventes_demo",
    },
    {
        "name": "demo-kafka-events",
        "source_type": "kafka",
        "source_config": {"cursors": {}},
        "creds": {
            "bootstrap_servers": "parus-dlt-demo-kafka:9092",
            "group_id": "parusdb-elt-demo",
            "security_protocol": "PLAINTEXT",
        },
        "tables": ["ventes_evenements"],
        "write_mode": "incremental",
        "destination_schema": "evenements_kafka",
    },
]


def main() -> None:
    owner_id = DEFAULT_OWNER_ID
    args = sys.argv[1:]
    if len(args) >= 2 and args[0] == "--owner":
        owner_id = args[1]
    # Rôle propriétaire : le rôle système admin, résolu par sous-requête
    # (seedé par 01-parusdb-app.sql, l'id varie selon l'installation).
    owner_role = "(select id from iam.roles where key = 'admin')"
    key = read_key()
    out = os.path.join(DEMO, ".pipelines-seed.sql")
    with open(out, "w", encoding="utf-8") as fh:
        for p in PIPELINES:
            blob = encrypt_secret(json.dumps(p["creds"]), key)
            fh.write(
                "insert into connectors.pipelines "
                "(owner_id, owner_role_id, name, source_type, source_config, "
                "credentials_encrypted, selected_tables, write_mode, cron, "
                "destination_catalog, destination_schema, status)\n"
                f"values ({lit(owner_id)}, {owner_role}, {lit(p['name'])}, "
                f"{lit(p['source_type'])}, {lit(p['source_config'])}, {lit(blob)}, "
                f"{lit(p['tables'])}, {lit(p['write_mode'])}, '', {lit('dev')}, "
                f"{lit(p['destination_schema'])}, 'active');\n"
            )
        fh.write(
            "insert into connectors.pipeline_runs (pipeline_id, status, trigger, message)\n"
            "select id, 'queued', 'creation', 'Test e2e ELT - chargement initial'\n"
            "  from connectors.pipelines where name like 'demo-%';\n"
        )
    print(f"SQL écrit dans {out} (aucune valeur secrète affichée)")


if __name__ == "__main__":
    sys.exit(main())
