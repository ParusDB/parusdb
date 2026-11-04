"""Destination Iceberg du lakehouse ParusDB (Polaris + RustFS S3).

Rôles stricts (AGENTS.md §10 et §12) : le runner écrit les données via
dlt + pyiceberg dans le catalogue Polaris (REST) du pipeline ; les
credentials S3 des données sont vendus par Polaris (vended credentials).
Seule la synchronisation d'état de dlt (table `_dlt_pipeline_state`)
utilise l'accès S3 d'infrastructure, fourni dans la section
`destination.filesystem` (l'accès à la base du bucket n'est pas une clé de
données applicative).

dlt reçoit la configuration via le `secrets.toml` **du répertoire de travail
du run** (config projet dlt, prioritaire sur la config globale) : clés exactes
attendues par pyiceberg (`header.Polaris-Realm` notamment, non exprimables
proprement en variables d'environnement). Le fichier est propre au conteneur
jetable et disparaît avec lui.
"""

import json
import os

CATALOG_NAME = os.environ.get("PARUSDB_ICEBERG_CATALOG_NAME", "parus")
S3_BUCKET = os.environ.get("PARUSDB_S3_BUCKET", "parus-lakehouse")


def iceberg_props(warehouse: str) -> dict:
    """Propriétés pyiceberg du catalogue REST Polaris d'un run."""
    client_id = os.environ.get("PARUSDB_POLARIS_CLIENT_ID", "root")
    client_secret = os.environ.get("PARUSDB_POLARIS_CLIENT_SECRET", "")
    if not client_secret:
        raise RuntimeError(
            "PARUSDB_POLARIS_CLIENT_SECRET manquante : impossible de joindre "
            "le catalogue Polaris."
        )
    return {
        "uri": os.environ.get(
            "PARUSDB_POLARIS_URI", "http://polaris:8181/api/catalog"
        ),
        "type": "rest",
        "warehouse": warehouse,
        "credential": f"{client_id}:{client_secret}",
        "scope": "PRINCIPAL_ROLE:ALL",
        # Credentials S3 vendus par Polaris : le runner ne détient aucune clé
        # de données. L'endpoint interne est fourni en secours (config du
        # catalogue).
        "header.X-Iceberg-Access-Delegation": "vended-credentials",
        "header.Polaris-Realm": os.environ.get("PARUSDB_POLARIS_REALM", "POLARIS"),
        "s3.endpoint": os.environ.get("PARUSDB_S3_ENDPOINT", "http://rustfs:9000"),
        "s3.region": os.environ.get("PARUSDB_S3_REGION", "us-east-1"),
    }


def _toml_value(value) -> str:
    # Une chaîne JSON est une chaîne TOML valide (guillemets + échappements).
    return json.dumps(value)


def write_iceberg_secrets(workdir: str, warehouse: str) -> None:
    """Écrit <workdir>/.dlt/secrets.toml (config projet dlt du run).

    Deux sections :
      - `iceberg_catalog` : catalogue REST Polaris consommé par pyiceberg ;
      - `destination.filesystem` : la destination dlt exige `bucket_url`
        (validation de configuration) ; `credentials` sert à la
        synchronisation d'état (lecture/écriture `_dlt_pipeline_state`).
    """
    props = iceberg_props(warehouse)
    lines = [
        "# Généré par le runner ParusDB — spécifique à ce run, jamais commité.",
        "[iceberg_catalog]",
        f"iceberg_catalog_name = {_toml_value(CATALOG_NAME)}",
        'iceberg_catalog_type = "rest"',
        "",
        "[iceberg_catalog.iceberg_catalog_config]",
    ]
    for key, value in props.items():
        lines.append(f"{key} = {_toml_value(value)}")
    lines += [
        "",
        "[destination.filesystem]",
        f"bucket_url = {_toml_value(f's3://{S3_BUCKET}/{warehouse}')}",
        "",
        "[destination.filesystem.credentials]",
        f"aws_access_key_id = {_toml_value(os.environ.get('PARUSDB_S3_ACCESS_KEY_ID', ''))}",
        f"aws_secret_access_key = {_toml_value(os.environ.get('PARUSDB_S3_SECRET_ACCESS_KEY', ''))}",
        f"endpoint_url = {_toml_value(os.environ.get('PARUSDB_S3_ENDPOINT', 'http://rustfs:9000'))}",
        f"region_name = {_toml_value(os.environ.get('PARUSDB_S3_REGION', 'us-east-1'))}",
    ]
    secrets_dir = os.path.join(workdir, ".dlt")
    os.makedirs(secrets_dir, exist_ok=True)
    path = os.path.join(secrets_dir, "secrets.toml")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    os.chmod(path, 0o600)


def ensure_namespace(warehouse: str, namespace: str) -> None:
    """Crée le namespace (schéma) du dataset s'il n'existe pas dans Polaris."""
    from pyiceberg.catalog import load_catalog

    catalog = load_catalog(CATALOG_NAME, **iceberg_props(warehouse))
    if namespace in {ns[0] if isinstance(ns, tuple) else ns
                     for ns in catalog.list_namespaces()}:
        return
    try:
        catalog.create_namespace(namespace)
    except Exception:
        # Course possible si la table se crée entre-temps : tolérer.
        pass
