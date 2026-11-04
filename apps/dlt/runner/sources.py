"""Registre des sources ELT exécutables par le runner ParusDB.

Trois familles (spec §Connecteurs) :

- `sql` : sources Core « SQL Databases » via la source dlt `sql_database`
  (tous les dialectes SQLAlchemy ; pilotes installés dans l'image :
  PostgreSQL, MySQL/MariaDB, SQL Server, SQLite) ;
- `endpoints` : source Core « REST APIs » (`dlt.sources.rest_api`) — chaque
  « table » sélectionnée est un chemin d'endpoint paginé ;
- `globs` : source Core « Object store & filesystem » (`dlt.sources.filesystem`,
  via le source `readers`) — chaque « table » est un glob de fichiers
  CSV/Parquet/JSONL ;
- `resources` : sources verified du dépôt officiel dlt-hub/verified-sources
  (vendées dans l'image) — credentials = kwargs de la factory, « tables » =
  ressources dlt sélectionnées via `with_resources`.

Les sources verified n'existent pas sur PyPI : l'image les récupère par clone
épinglé du dépôt (Dockerfile, VERIFIED_SOURCES_SHA) et installe leurs
requirements. Toute nouvelle source du dépôt s'ajoute dans VERIFIED_MODULES.
"""

import importlib
import inspect
import itertools
import json
import os
import re
from urllib.parse import quote_plus

import dlt
from dlt.sources.sql_database import sql_database

# ---------------------------------------------------------------------------
# Sources Core — SQL Databases (sql_database, dialectes SQLAlchemy)
# ---------------------------------------------------------------------------

# Pilotes réellement installés dans l'image (Dockerfile). Les autres dialectes
# restent déclarés : le runner produit une erreur actionnable si le pilote
# manque.
SQL_DIALECTS: dict[str, dict] = {
    "postgresql": {
        "url": "postgresql+psycopg2://{username}:{password}@{host}:{port}/{database}",
        "driver": "psycopg2",
        "default_port": "5432",
        "default_schema": "public",
    },
    "mysql": {
        "url": "mysql+pymysql://{username}:{password}@{host}:{port}/{database}",
        "driver": "pymysql",
        "default_port": "3306",
        "default_schema": None,
    },
    "mariadb": {
        "url": "mariadb+pymysql://{username}:{password}@{host}:{port}/{database}",
        "driver": "pymysql",
        "default_port": "3306",
        "default_schema": None,
    },
    "sqlserver": {
        "url": "mssql+pymssql://{username}:{password}@{host}:{port}/{database}",
        "driver": "pymssql",
        "default_port": "1433",
        "default_schema": "dbo",
    },
    "sqlite": {
        "url": "sqlite:///{database}",
        "driver": "sqlite3",
        "default_port": None,
        "default_schema": None,
    },
    "oracle": {
        "url": "oracle+oracledb://{username}:{password}@{host}:{port}/{database}",
        "driver": "oracledb",
        "default_port": "1521",
        "default_schema": None,
    },
    "snowflake": {
        "url": "snowflake://{username}:{password}@{host}/{database}?warehouse={warehouse}",
        "driver": "snowflake",
        "default_port": "443",
        "default_schema": None,
    },
    "bigquery": {
        "url": "bigquery://{database}",
        "driver": "bigquery",
        "default_port": None,
        "default_schema": None,
    },
    "redshift": {
        "url": "redshift+psycopg2://{username}:{password}@{host}:{port}/{database}",
        "driver": "psycopg2",
        "default_port": "5439",
        "default_schema": "public",
    },
    "cockroachdb": {
        "url": "cockroachdb+psycopg2://{username}:{password}@{host}:{port}/{database}",
        "driver": "psycopg2",
        "default_port": "26257",
        "default_schema": "public",
    },
    "sap_hana": {
        "url": "hana://{username}:{password}@{host}:{port}/{database}",
        "driver": "hdbcli",
        "default_port": "39017",
        "default_schema": None,
    },
    "firebird": {
        "url": "firebird+fdb://{username}:{password}@{host}:{port}/{database}",
        "driver": "fdb",
        "default_port": "3050",
        "default_schema": None,
    },
    "teradata": {
        "url": "teradatasql://{username}:{password}@{host}:{port}/{database}",
        "driver": "teradatasql",
        "default_port": "1025",
        "default_schema": None,
    },
    "db2": {
        "url": "db2+ibm_db://{username}:{password}@{host}:{port}/{database}",
        "driver": "ibm_db",
        "default_port": "50000",
        "default_schema": None,
    },
}

CURSOR_COLUMN_HINTS = (
    "updated_at",
    "modified_at",
    "last_modified",
    "last_modified_at",
    "created_at",
    "updated",
)


def sql_url(source_type: str, credentials: dict) -> str:
    if source_type not in SQL_DIALECTS:
        raise ValueError(f"Dialecte SQL inconnu : {source_type}")
    dialect = SQL_DIALECTS[source_type]
    fields = dict(credentials)
    fields.setdefault("port", dialect["default_port"] or "")
    try:
        url = dialect["url"].format(
            username=quote_plus(str(fields.get("username", ""))),
            password=quote_plus(str(fields.get("password", ""))),
            host=fields.get("host", ""),
            port=fields.get("port", ""),
            database=fields.get("database", ""),
            warehouse=quote_plus(str(fields.get("warehouse", ""))),
        )
    except KeyError as exc:
        raise ValueError(
            f"Champ de connexion manquant pour {source_type} : {exc.args[0]}"
        ) from exc
    return url


def _require_driver(source_type: str):
    dialect = SQL_DIALECTS[source_type]
    driver = dialect["driver"]
    if driver == "sqlite3":
        return
    try:
        importlib.import_module(driver)
    except ImportError as exc:
        raise RuntimeError(
            f"Le pilote {driver} (source {source_type}) n'est pas installé "
            f"dans l'image du runner ParusDB. Ajoutez-le au Dockerfile de "
            f"apps/dlt puis reconstruisez l'image."
        ) from exc


def build_sql_source(spec: dict):
    """Source dlt sql_database : tables sélectionnées + curseurs incrémentaux."""
    source_type = spec["source_type"]
    credentials = spec["credentials"]
    tables = spec["tables"]
    cursors = spec.get("cursors") or {}
    _require_driver(source_type)
    url = sql_url(source_type, credentials)
    schema = credentials.get("schema") or SQL_DIALECTS[source_type]["default_schema"]
    source = sql_database(credentials=url, schema=schema, table_names=list(tables))
    for table, cursor in cursors.items():
        if not cursor or table not in source.resources:
            continue
        source.resources[table].apply_hints(
            incremental=dlt.sources.incremental(cursor)
        )
    return source


def has_primary_keys(source) -> bool:
    """True si toutes les ressources de la source ont une clé primaire."""
    try:
        resources = list(source.resources.values())
    except AttributeError:
        return False
    if not resources:
        return False
    return all(bool(resource._hints.get("primary_key")) for resource in resources)


def introspect_sql(spec: dict) -> dict:
    """Liste tables + vues de la base source (inspecteur SQLAlchemy)."""
    from sqlalchemy import create_engine, inspect

    source_type = spec["source_type"]
    credentials = spec["credentials"]
    _require_driver(source_type)
    url = sql_url(source_type, credentials)
    schema = credentials.get("schema") or SQL_DIALECTS[source_type]["default_schema"]
    engine = create_engine(url)
    inspector = inspect(engine)
    names = sorted(
        set(inspector.get_table_names(schema=schema))
        | set(inspector.get_view_names(schema=schema))
    )
    tables = []
    for name in names:
        columns = inspector.get_columns(name, schema=schema)
        # Curseur suggéré : première colonne « dernière modification »
        # connue, sinon première colonne de création.
        cursor = next(
            (
                hint
                for hint in CURSOR_COLUMN_HINTS
                if any(str(c["name"]).lower() == hint for c in columns)
            ),
            None,
        )
        tables.append(
            {
                "name": name,
                "columns": [
                    {"name": c["name"], "type": str(c["type"])} for c in columns
                ],
                "cursor": cursor,
            }
        )
    engine.dispose()
    return {"ok": True, "tables": tables}


# ---------------------------------------------------------------------------
# Sources Core — REST APIs (endpoints paginés génériques)
# ---------------------------------------------------------------------------


def _endpoint_table_name(endpoint: str) -> str:
    name = endpoint.strip("/").split("/")[-1] or "endpoint"
    name = re.sub(r"[^0-9a-zA-Z_]+", "_", name).strip("_").lower()
    return name or "endpoint"


def build_rest_api_source(spec: dict):
    from dlt.sources.rest_api import rest_api_source

    credentials = spec["credentials"]
    base_url = credentials.get("base_url", "").rstrip("/")
    client: dict = {"base_url": base_url}
    token = credentials.get("api_key")
    if token:
        client["auth"] = {"type": "bearer", "token": token}
    resources = []
    for endpoint in spec["tables"]:
        resources.append(
            {
                "name": _endpoint_table_name(endpoint),
                "endpoint": {"path": endpoint},
            }
        )
    return rest_api_source({"client": client, "resources": resources})


def introspect_rest_api(spec: dict) -> dict:
    # Rien à introspecter : l'utilisateur définit lui-même les chemins
    # d'endpoints (validés à l'exécution par dlt).
    return {
        "ok": True,
        "tables": [],
        "note": (
            "Ajoutez les chemins d'endpoints à charger (ex. users, orders). "
            "La pagination est gérée par dlt."
        ),
    }


# ---------------------------------------------------------------------------
# Sources Core — Object store & filesystem (readers : CSV / Parquet / JSONL)
# ---------------------------------------------------------------------------


def _filesystem_env(credentials: dict) -> None:
    """Credentials du filesystem source via variables dlt (config injection)."""
    mapping = [
        ("access_key_id", "SOURCES__FILESYSTEM__CREDENTIALS__AWS_ACCESS_KEY_ID"),
        ("secret_access_key", "SOURCES__FILESYSTEM__CREDENTIALS__AWS_SECRET_ACCESS_KEY"),
        ("region", "SOURCES__FILESYSTEM__CREDENTIALS__REGION_NAME"),
        ("endpoint_url", "SOURCES__FILESYSTEM__CREDENTIALS__ENDPOINT_URL"),
        ("account_name", "SOURCES__FILESYSTEM__CREDENTIALS__AZURE_STORAGE_ACCOUNT_NAME"),
        ("account_key", "SOURCES__FILESYSTEM__CREDENTIALS__AZURE_STORAGE_ACCOUNT_KEY"),
        ("username", "SOURCES__FILESYSTEM__CREDENTIALS__SFTP_USERNAME"),
        ("password", "SOURCES__FILESYSTEM__CREDENTIALS__SFTP_PASSWORD"),
    ]
    for key, env_var in mapping:
        if credentials.get(key):
            os.environ[env_var] = str(credentials[key])
    # Clé service account (GCS/GDrive) : JSON complet dans la config dlt.
    if credentials.get("credentials"):
        os.environ["SOURCES__FILESYSTEM__CREDENTIALS__CREDENTIALS"] = str(
            credentials["credentials"]
        )


def _glob_reader(readers_source, glob: str):
    lowered = glob.lower()
    if lowered.endswith(".parquet"):
        return readers_source.read_parquet()
    if lowered.endswith(".jsonl") or lowered.endswith(".ndjson"):
        return readers_source.read_jsonl()
    return readers_source.read_csv()


def _glob_table_name(glob: str) -> str:
    base = glob.strip("/").split("/")[-1] or "files"
    base = re.sub(r"\.(csv|parquet|jsonl|ndjson)$", "", base, flags=re.IGNORECASE)
    base = re.sub(r"[^0-9a-zA-Z_]+", "_", base).strip("_").lower()
    return base or "files"


def build_filesystem_source(spec: dict):
    """Un reader dlt par glob sélectionné (CSV, Parquet ou JSONL)."""
    from dlt.sources.filesystem import readers

    credentials = spec["credentials"]
    _filesystem_env(credentials)
    bucket_url = credentials["bucket_url"]
    pipes = []
    for glob in spec["tables"]:
        readers_source = readers(bucket_url=bucket_url, file_glob=glob)
        reader = _glob_reader(readers_source, glob)
        pipes.append(reader.with_name(_glob_table_name(glob)))
    return pipes


def introspect_filesystem(spec: dict) -> dict:
    """Liste les premiers fichiers du bucket (aide au choix des globs)."""
    from dlt.sources.filesystem import filesystem

    credentials = spec["credentials"]
    _filesystem_env(credentials)
    bucket_url = credentials["bucket_url"]
    files = filesystem(bucket_url=bucket_url, file_glob=credentials.get("file_glob") or "**")
    items = list(itertools.islice(files, 50))
    return {
        "ok": True,
        "tables": [{"name": item["file_name"], "columns": []} for item in items],
    }


# ---------------------------------------------------------------------------
# Sources verified (dlt-hub/verified-sources, vendées dans l'image)
# ---------------------------------------------------------------------------

# Clé exposée à l'UI -> module Python vendé (dossier du dépôt).
#
# `scraping` (Scrapy) et `unstructured_data` ne sont pas exposées : ces sources
# sont pilotées par du code (spiders, parsers de fichiers) et n'ont pas de
# factory credentials -> elles restent utilisables en étendant le runner.
VERIFIED_MODULES: dict[str, str] = {
    "airtable": "airtable",
    "asana": "asana_dlt",
    "bing_webmaster": "bing_webmaster",
    "chess": "chess",
    "facebook_ads": "facebook_ads",
    "freshdesk": "freshdesk",
    "github": "github",
    "google_ads": "google_ads",
    "google_analytics": "google_analytics",
    "google_sheets": "google_sheets",
    "hubspot": "hubspot",
    "inbox": "inbox",
    "jira": "jira",
    "matomo": "matomo",
    "mongodb": "mongodb",
    "mux": "mux",
    "notion": "notion",
    "personio": "personio",
    "pipedrive": "pipedrive",
    "salesforce": "salesforce",
    "shopify": "shopify_dlt",
    "slack": "slack",
    "strapi": "strapi",
    "stripe": "stripe_analytics",
    "workable": "workable",
    "zendesk": "zendesk",
}

# Sources verified exposant une `@dlt.resource(standalone=True)` au premier
# niveau (pas de factory de source) : credentials injectés par config dlt
# (SOURCES__<section>__CREDENTIALS__<champ>), paramètre principal explicite.
RESOURCE_MODULES: dict[str, dict] = {
    "kafka": {
        "module": "kafka",
        "attr": "kafka_consumer",
        "tables_param": "topics",
        "fields": [
            {"name": "bootstrap_servers", "required": True, "type": "text"},
            {"name": "group_id", "required": True, "type": "text"},
            {"name": "security_protocol", "required": True, "type": "text"},
            {"name": "sasl_mechanisms", "required": False, "type": "text"},
            {"name": "sasl_username", "required": False, "type": "text"},
            {"name": "sasl_password", "required": False, "type": "password"},
        ],
    },
    "amazon_kinesis": {
        "module": "kinesis",
        "attr": "kinesis_stream",
        "tables_param": "stream_name",
        "fields": [
            {"name": "aws_access_key_id", "required": True, "type": "text"},
            {"name": "aws_secret_access_key", "required": True, "type": "password"},
            {"name": "region_name", "required": False, "type": "text"},
            {"name": "endpoint_url", "required": False, "type": "text"},
        ],
    },
    "postgres_replication": {
        "module": "pg_replication",
        "attr": "replication_resource",
        "tables_param": None,
        "fields": [
            {"name": "host", "required": True, "type": "text"},
            {"name": "port", "required": True, "type": "text"},
            {"name": "database", "required": True, "type": "text"},
            {"name": "username", "required": True, "type": "text"},
            {"name": "password", "required": True, "type": "password"},
            # Slot et publication créés en amont sur la base source
            # (init_replication non exécuté par le runner).
            {"name": "slot_name", "required": True, "type": "text"},
            {"name": "pub_name", "required": True, "type": "text"},
        ],
    },
}


def _factory_wrapper_type():
    """Type exact du wrapper produit par @dlt.source (DltSourceFactoryWrapper)."""
    try:
        from dlt.sources.decorators import DltSourceFactoryWrapper

        return DltSourceFactoryWrapper
    except ImportError:
        return None


# Modules exposant plusieurs factories : celle exposée à l'UI.
PREFERRED_FACTORIES: dict[str, str] = {
    "github": "github_reactions",
    "zendesk": "zendesk_support",
    "chess": "source",
}


def find_source_factory(module):
    """Trouve la factory @dlt.source d'un module de source verified."""
    wrapper = _factory_wrapper_type()
    candidates = []
    for name in dir(module):
        if name.startswith("_"):
            continue
        obj = getattr(module, name)
        if wrapper is not None:
            if isinstance(obj, wrapper):
                candidates.append(obj)
        else:
            if type(obj).__name__ == "DltSourceFactoryWrapper":
                candidates.append(obj)
    if not candidates:
        raise RuntimeError(
            f"aucune source dlt trouvée dans le module {module.__name__}"
        )
    if len(candidates) == 1:
        return candidates[0]
    module_name = module.__name__.split(".")[-1]
    preferred = PREFERRED_FACTORIES.get(module_name)
    for candidate in candidates:
        if preferred and getattr(candidate, "__name__", "") == preferred:
            return candidate
    for candidate in candidates:
        if getattr(candidate, "__name__", "") == f"{module_name}_source":
            return candidate
    for candidate in candidates:
        if getattr(candidate, "__name__", "") == module_name:
            return candidate
    for candidate in sorted(
        candidates, key=lambda c: len(getattr(c, "__name__", ""))
    ):
        if getattr(candidate, "__name__", "").startswith(module_name):
            return candidate
    return candidates[0]


def build_verified_source(spec: dict):
    module_name = VERIFIED_MODULES[spec["source_type"]]
    module = importlib.import_module(module_name)
    factory = find_source_factory(module)
    # Champs du wizard : les paramètres directs de la factory + les champs du
    # spec `credentials` (regroupés au build dans un dict credentials). Les
    # sources sans paramètre (asana, mux...) reçoivent leurs credentials par
    # config dlt : SOURCES__<nom_de_source>__CREDENTIALS__<champ>.
    params = set(inspect.signature(factory).parameters)
    direct = {}
    nested = {}
    for key, value in spec["credentials"].items():
        if value == "":
            continue
        if key in params:
            direct[key] = value
        else:
            nested[key] = value
    if nested:
        if "credentials" in params:
            direct["credentials"] = nested
        else:
            source_name = getattr(factory, "name", None) or module_name
            for key, value in nested.items():
                os.environ[
                    f"SOURCES__{source_name.upper()}__CREDENTIALS__{key.upper()}"
                ] = str(value)
    source = factory(**direct)
    tables = spec["tables"]
    if tables:
        source = source.with_resources(*tables)
    return source


def introspect_verified(spec: dict) -> dict:
    """Construit la source (test de connexion) et liste ses ressources dlt."""
    source = build_verified_source(spec)
    names = sorted(source.resources.keys())
    return {"ok": True, "tables": [{"name": name, "columns": []} for name in names]}


# ---------------------------------------------------------------------------
# Sources verified « ressource standalone » (kafka, kinesis, pg_replication)
# ---------------------------------------------------------------------------


def _resource_env(module: str, credentials: dict) -> None:
    """Credentials via config dlt : SOURCES__<section>__CREDENTIALS__<champ>."""
    for key, value in credentials.items():
        if value != "":
            os.environ[
                f"SOURCES__{module.upper()}__CREDENTIALS__{key.upper()}"
            ] = str(value)


def build_resource_module_source(spec: dict):
    info = RESOURCE_MODULES[spec["source_type"]]
    credentials = dict(spec["credentials"])
    module = importlib.import_module(info["module"])
    resource = getattr(module, info["attr"])
    tables = list(spec["tables"])

    if spec["source_type"] == "postgres_replication":
        # Credentials = URL de connexion Postgres (spec ConnectionString).
        creds = {k: v for k, v in credentials.items()
                 if k in ("host", "port", "database", "username", "password")}
        os.environ["SOURCES__PG_REPLICATION__CREDENTIALS"] = sql_url(
            "postgresql", creds
        )
        return resource(
            slot_name=credentials["slot_name"],
            pub_name=credentials["pub_name"],
        )

    _resource_env(info["module"], credentials)
    if info["tables_param"] == "topics":
        return resource(tables)
    if info["tables_param"] == "stream_name":
        if len(tables) != 1:
            raise ValueError(
                "Amazon Kinesis requiert exactement un nom de flux (stream)."
            )
        return resource(tables[0])
    return resource()


def introspect_resource_module(spec: dict) -> dict:
    # Rien à introspecter : le paramètre principal (topics, stream) est saisi
    # par l'utilisateur, la connexion est validée au premier run.
    info = RESOURCE_MODULES[spec["source_type"]]
    return {
        "ok": True,
        "tables": [],
        "note": (
            "Source à ressource unique : saisissez le paramètre principal "
            "(topics Kafka, flux Kinesis). La connexion est validée à la "
            "première exécution."
        ),
    }


# ---------------------------------------------------------------------------
# Registre général
# ---------------------------------------------------------------------------


def kind_of(source_type: str) -> str:
    if source_type in SQL_DIALECTS:
        return "sql"
    if source_type == "rest_api":
        return "endpoints"
    if source_type == "filesystem":
        return "globs"
    if source_type in VERIFIED_MODULES:
        return "resources"
    if source_type in RESOURCE_MODULES:
        return "resource"
    raise ValueError(f"Type de source inconnu : {source_type}")


def build_source(spec: dict):
    """Construit la source dlt d'un pipeline (DltSource ou liste de ressources)."""
    kind = kind_of(spec["source_type"])
    if kind == "sql":
        return build_sql_source(spec)
    if kind == "endpoints":
        return build_rest_api_source(spec)
    if kind == "globs":
        return build_filesystem_source(spec)
    if kind == "resource":
        return build_resource_module_source(spec)
    return build_verified_source(spec)


def introspect(spec: dict) -> dict:
    """Test de connexion + découverte des « tables » d'une source."""
    kind = kind_of(spec["source_type"])
    if kind == "sql":
        return introspect_sql(spec)
    if kind == "endpoints":
        return introspect_rest_api(spec)
    if kind == "globs":
        return introspect_filesystem(spec)
    if kind == "resource":
        return introspect_resource_module(spec)
    return introspect_verified(spec)


# ---------------------------------------------------------------------------
# Catalogue machine (génère les définitions de l'UI, apps/nextjs/lib/sources.ts)
# ---------------------------------------------------------------------------


def _is_secret_hint(field_type) -> bool:
    text = str(field_type)
    return "SecretSentinel" in text or "TSecretValue" in text


def _spec_fields(annotation) -> list[dict] | None:
    """Champs d'un spec credentials (Union : première variante, la plus simple)."""
    import dataclasses
    import typing

    from dlt.common.configuration.specs.base_configuration import (
        CredentialsConfiguration,
    )

    candidates = [
        arg
        for arg in typing.get_args(annotation)
        if isinstance(arg, type) and issubclass(arg, CredentialsConfiguration)
    ]
    if not candidates and isinstance(annotation, type) and issubclass(
        annotation, CredentialsConfiguration
    ):
        candidates = [annotation]
    for cls in candidates:
        try:
            instance = cls()
            resolvable = instance.get_resolvable_fields()
            if not resolvable:
                continue
            defaults = {
                field.name: field.default
                for field in dataclasses.fields(instance)
                if field.name in resolvable
            }
            fields = []
            for name, field_type in resolvable.items():
                default = defaults.get(name, dataclasses.MISSING)
                required = (
                    default is dataclasses.MISSING
                    or default is dlt.secrets.value
                    or default is dlt.config.value
                )
                fields.append(
                    {
                        "name": name,
                        "required": bool(required),
                        "type": "password" if _is_secret_hint(field_type) else "text",
                    }
                )
            return fields
        except Exception:
            continue
    return None


def _signature_fields(factory) -> list[dict]:
    fields = []
    for param in inspect.signature(factory).parameters.values():
        default = param.default
        annotation = param.annotation
        # Paramètre credentials complexe : exposer les champs du spec (dlt
        # coerce le dict vers le membre de l'Union qui correspond).
        if param.name == "credentials" and annotation is not inspect.Parameter.empty:
            spec_fields = _spec_fields(annotation)
            if spec_fields:
                fields.extend(spec_fields)
                continue
        if default is inspect.Parameter.empty:
            required, kind = True, "text"
        elif default is dlt.secrets.value or (
            type(default).__name__ in ("TSecretValue", "SecretValue")
        ):
            required, kind = True, "password"
        elif default is None:
            required, kind = False, "text"
        else:
            required, kind = False, "text"
        fields.append({"name": param.name, "required": required, "type": kind})
    return fields


def catalog() -> list[dict]:
    entries = []
    for key in SQL_DIALECTS:
        entries.append({"key": key, "kind": "sql", "module": None})
    entries.append({"key": "rest_api", "kind": "endpoints", "module": None})
    entries.append({"key": "filesystem", "kind": "globs", "module": None})
    for key, info in RESOURCE_MODULES.items():
        entries.append(
            {
                "key": key,
                "kind": "resource",
                "module": info["module"],
                "fields": info["fields"],
            }
        )
    for key, module_name in VERIFIED_MODULES.items():
        entry = {"key": key, "kind": "resources", "module": module_name}
        try:
            module = importlib.import_module(module_name)
            factory = find_source_factory(module)
            entry["factory"] = getattr(factory, "__name__", None)
            entry["fields"] = _signature_fields(factory)
        except Exception as exc:  # dépendance manquante : signalé, pas fatal
            entry["error"] = str(exc)
        entries.append(entry)
    return entries
