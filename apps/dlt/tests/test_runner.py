"""Tests unitaires du runner dlt ParusDB (AGENTS.md §13).

Ciblent les fonctions pures — pas de stack requise : construction des
credentials, registre des types de sources (miroir de
apps/nextjs/lib/sources.ts), format de chiffrement compatible avec le BFF
Next.js (lib/crypto.ts).

Exécution :
    cd apps/dlt && pytest -q tests
"""

import base64
import os

import pytest

os.environ.setdefault("PARUSDB_ENCRYPTION_KEY", "k" * 64)

from runner import crypto, sources  # noqa: E402


# ---------------------------------------------------------------------------
# construction d'URL SQL (sql_url)
# ---------------------------------------------------------------------------


def test_sql_url_postgresql_nominal():
    url = sources.sql_url(
        "postgresql",
        {
            "host": "db",
            "port": 5432,
            "database": "demo",
            "username": "demo",
            "password": "demo",
        },
    )
    assert url == "postgresql+psycopg2://demo:demo@db:5432/demo"


def test_sql_url_echappe_les_caracteres_speciaux():
    # Un mot de passe avec caractères réservés d'URL doit être encodé :
    # sinon une URL mal formée part vers le pilote (credentials leak dans
    # les erreurs de connexion potentiels).
    url = sources.sql_url(
        "postgresql",
        {
            "host": "db",
            "port": "5432",
            "database": "demo",
            "username": "u@ser",
            "password": "p@ss:w/rd?x=1",
        },
    )
    assert url == (
        "postgresql+psycopg2://u%40ser:p%40ss%3Aw%2Frd%3Fx%3D1@db:5432/demo"
    )


def test_sql_url_port_par_defaut():
    url = sources.sql_url(
        "postgresql",
        {"host": "h", "database": "d", "username": "u", "password": "p"},
    )
    assert url == "postgresql+psycopg2://u:p@h:5432/d"


def test_sql_url_champ_manquant_tolerant():
    # sql_url est tolérant (les champs manquants deviennent vides) : les
    # champs requis sont validés par le wizard côté BFF, le runner ajoute
    # le port par défaut du dialecte.
    url = sources.sql_url(
        "sqlserver",
        {"host": "h", "database": "d", "username": "u", "password": "p"},
    )
    assert url == "mssql+pymssql://u:p@h:1433/d"


def test_sql_url_dialecte_inconnu():
    with pytest.raises(ValueError, match="Dialecte SQL inconnu"):
        sources.sql_url("oracleplus", {})


# ---------------------------------------------------------------------------
# registre des types (kind_of) et cohérence avec le wizard frontend
# ---------------------------------------------------------------------------


def test_kind_of_couvre_tous_les_registres():
    for key in sources.SQL_DIALECTS:
        assert sources.kind_of(key) == "sql"
    assert sources.kind_of("rest_api") == "endpoints"
    assert sources.kind_of("filesystem") == "globs"
    for key in sources.VERIFIED_MODULES:
        assert sources.kind_of(key) == "resources"
    for key in sources.RESOURCE_MODULES:
        assert sources.kind_of(key) == "resource"


def test_kind_of_inconnu_refuse():
    with pytest.raises(ValueError, match="Type de source inconnu"):
        sources.kind_of("nimportequoi")


def test_sources_utilisees_par_le_wizard_existent():
    # Le wizard (apps/nextjs/lib/sources.ts) construit ses signup à partir de
    # ces clés : chaque clé exposée côté UI doit être exécutable par le
    # runner. Régression = pipeline créable dans l'UI et refusé au run.
    for key in ("postgresql", "mysql", "mariadb", "sqlserver", "sqlite",
                "rest_api", "filesystem", "kafka", "airtable", "github",
                "postgres_replication"):
        assert sources.kind_of(key) in (
            "sql", "endpoints", "globs", "resources", "resource",
        )


def test_kafka_est_une_ressource_standalone_avec_ses_credentials():
    info = sources.RESOURCE_MODULES["kafka"]
    assert info["attr"] == "kafka_consumer"
    assert info["tables_param"] == "topics"
    field_names = [f["name"] for f in info["fields"]]
    for required in ("bootstrap_servers", "group_id", "security_protocol"):
        assert required in field_names


# ---------------------------------------------------------------------------
# crypto compatible BFF (lib/crypto.ts)
# ---------------------------------------------------------------------------


def test_decrypt_secret_format_bff():
    # Reconstruit un blob au format exact du BFF Next.js :
    # base64(iv[12] || ciphertext || tag[16]).
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    secret = "k" * 64
    plaintext = '{"password":"l33t"}'
    key = crypto.derive_key(secret)
    iv = os.urandom(12)
    blob_b64 = base64.b64encode(
        iv + AESGCM(key).encrypt(iv, plaintext.encode(), None)
    ).decode()
    assert crypto.decrypt_secret(blob_b64, secret) == plaintext


def test_decrypt_secret_mauvaise_cle_refusee():
    blob = base64.b64encode(os.urandom(40)).decode()
    with pytest.raises(crypto.DecryptionError):
        crypto.decrypt_secret(blob, "autre" * 16)


def test_derive_key_est_un_sha256_hexa_stable():
    key = crypto.derive_key("a" * 64)
    assert len(key) == 32
    assert key == crypto.derive_key("a" * 64)
    assert key != crypto.derive_key("b" * 64)
