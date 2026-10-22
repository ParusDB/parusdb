#!/bin/sh
#
# Bootstrap du moteur ELT dlt pour ParusDB.
#
# Prérequis : stacks Supabase (avec RustFS) et Polaris démarrées, schéma
# applicatif ParusDB appliqué (apps/supabase/sql/01-parusdb-app.sql).
#
# Étapes (toutes idempotentes, le script est relançable sans risque) :
#   1. vérification des prérequis (docker, compose, openssl) ;
#   2. création de .env depuis .env.example si absent : import de
#      PARUSDB_ENCRYPTION_KEY depuis apps/nextjs/.env.local, des credentials
#      root Polaris depuis apps/polaris/.env, génération du mot de passe
#      PostgreSQL du rôle parus_dlt ;
#   3. création du rôle parus_dlt (sql/01-dlt-role.sql) dans le Postgres
#      Supabase + application du schéma applicatif (politiques RLS TO parus_dlt) ;
#   4. construction de l'image du runner (dlt + sources verified) ;
#   5. démarrage de l'ordonnanceur (conteneur jetable par exécution) ;
#   6. vérification du runner (catalogue des sources + connexion Polaris).
#
# Usage :
#   sh setup.sh               # bootstrap complet puis démarrage
#   sh setup.sh --skip-start  # tout préparer sans démarrer l'ordonnanceur
#   sh setup.sh -h | --help   # aide
#

set -e

cd "$(dirname "$0")"

SCRIPT_DIR=$(pwd)
LOCAL_ENV="$SCRIPT_DIR/.env"
POLARIS_ENV="$SCRIPT_DIR/../polaris/.env"
NEXTJS_ENV_LOCAL="$SCRIPT_DIR/../nextjs/.env.local"
NEXTJS_ENV="$SCRIPT_DIR/../nextjs/.env"
APP_SQL="$SCRIPT_DIR/../supabase/sql/01-parusdb-app.sql"

print_help() {
    cat <<EOF
Usage: $(basename "$0") [options]

Options :
      --skip-start   Préparer tout (env, rôle, image) sans démarrer
  -h, --help          Afficher cette aide et sortir

Prérequis : stacks Supabase + Polaris démarrées, image construite par
'sh run.sh build' si absente.
EOF
}

fail() {
    echo "ERREUR : $1" >&2
    exit 1
}

read_env_var() {
    [ -f "$1" ] || return 0
    grep "^$2=" "$1" | head -n 1 | cut -d= -f2- | tr -d "\r" | sed -e 's/^"//' -e 's/"$//'
}

get_env_value() {
    read_env_var "$LOCAL_ENV" "$1"
}

set_env_value() {
    var="$1"
    val=$(printf '%s' "$2" | sed 's/[&|]/\\&/g')
    if grep -q "^${var}=" "$LOCAL_ENV"; then
        sed -i.old -e "s|^${var}=.*$|${var}=${val}|" "$LOCAL_ENV"
        rm -f "$LOCAL_ENV.old"
    else
        printf '%s=%s\n' "$var" "$2" >> "$LOCAL_ENV"
    fi
}

ensure_from_example() {
    var="$1"
    if [ -z "$(get_env_value "$var")" ]; then
        def=$(read_env_var "$SCRIPT_DIR/.env.example" "$var")
        if [ -n "$def" ]; then
            set_env_value "$var" "$def"
        fi
    fi
}

SKIP_START=0
while [ $# -gt 0 ]; do
    case "$1" in
        --skip-start) SKIP_START=1 ;;
        -h|--help) print_help; exit 0 ;;
        *) echo "Option inconnue : $1" >&2; print_help; exit 1 ;;
    esac
    shift
done

echo "===> Vérification des prérequis..."
command -v docker >/dev/null 2>&1 || fail "docker est requis (https://docs.docker.com/engine/install/)"
docker compose version >/dev/null 2>&1 || fail "le plugin docker compose est requis"
command -v openssl >/dev/null 2>&1 || fail "openssl est requis"

docker ps --filter name=supabase-db --format '{{.Names}}' 2>/dev/null | grep -q . \
    || fail "le conteneur supabase-db n'est pas démarré (cd apps/supabase && sh run.sh start)"
docker ps --filter name=parus-polaris --format '{{.Names}}' 2>/dev/null | grep -q . \
    || fail "le conteneur parus-polaris n'est pas démarré (cd apps/polaris && sh run.sh start)"
docker network inspect supabase_default >/dev/null 2>&1 \
    || fail "réseau Docker supabase_default introuvable : démarrez la stack Supabase"
[ -f "$POLARIS_ENV" ] || fail "apps/polaris/.env introuvable : lancez le setup de Polaris"
[ -f "$APP_SQL" ] || fail "apps/supabase/sql/01-parusdb-app.sql introuvable"

echo "===> Préparation de .env..."
if [ ! -f "$LOCAL_ENV" ]; then
    cp "$SCRIPT_DIR/.env.example" "$LOCAL_ENV"
    echo "    .env créé depuis .env.example"
fi

# Mot de passe du rôle PostgreSQL dédié.
if [ -z "$(get_env_value PARUSDB_DB_PASSWORD)" ]; then
    set_env_value PARUSDB_DB_PASSWORD "$(openssl rand -hex 24)"
    echo "    PARUSDB_DB_PASSWORD généré"
fi

# Import : clé de chiffrement des credentials (celle du BFF Next.js —
# sans elle, les credentials chiffrés des pipelines sont indéchiffrables).
if [ -z "$(get_env_value PARUSDB_ENCRYPTION_KEY)" ]; then
    ENCRYPTION_KEY=$(read_env_var "$NEXTJS_ENV_LOCAL" PARUSDB_ENCRYPTION_KEY)
    [ -n "$ENCRYPTION_KEY" ] || ENCRYPTION_KEY=$(read_env_var "$NEXTJS_ENV" PARUSDB_ENCRYPTION_KEY)
    [ -n "$ENCRYPTION_KEY" ] || fail "PARUSDB_ENCRYPTION_KEY absente de apps/nextjs/.env.local : impossible d'importer la clé de chiffrement des credentials"
    set_env_value PARUSDB_ENCRYPTION_KEY "$ENCRYPTION_KEY"
    echo "    PARUSDB_ENCRYPTION_KEY importée depuis apps/nextjs"
fi

# Import : credentials root Polaris (même principal que Trino, scope
# PRINCIPAL_ROLE:ALL → CATALOG_MANAGE_CONTENT sur les catalogues créés) et
# accès S3 du bucket lakehouse (synchronisation d'état dlt uniquement).
POLARIS_ROOT_CLIENT_ID=$(read_env_var "$POLARIS_ENV" POLARIS_ROOT_CLIENT_ID)
POLARIS_ROOT_CLIENT_SECRET=$(read_env_var "$POLARIS_ENV" POLARIS_ROOT_CLIENT_SECRET)
POLARIS_REALM=$(read_env_var "$POLARIS_ENV" POLARIS_REALM)
S3_ENDPOINT=$(read_env_var "$POLARIS_ENV" S3_ENDPOINT)
S3_REGION=$(read_env_var "$POLARIS_ENV" S3_REGION)
S3_BUCKET=$(read_env_var "$POLARIS_ENV" POLARIS_S3_BUCKET)
S3_ACCESS_KEY_ID=$(read_env_var "$POLARIS_ENV" S3_ACCESS_KEY_ID)
S3_SECRET_ACCESS_KEY=$(read_env_var "$POLARIS_ENV" S3_SECRET_ACCESS_KEY)
[ -n "$POLARIS_ROOT_CLIENT_SECRET" ] || fail "POLARIS_ROOT_CLIENT_SECRET absente de apps/polaris/.env"
[ -n "$POLARIS_ROOT_CLIENT_ID" ] || POLARIS_ROOT_CLIENT_ID=root
set_env_value PARUSDB_POLARIS_CLIENT_ID "$POLARIS_ROOT_CLIENT_ID"
set_env_value PARUSDB_POLARIS_CLIENT_SECRET "$POLARIS_ROOT_CLIENT_SECRET"
[ -n "$POLARIS_REALM" ] && set_env_value PARUSDB_POLARIS_REALM "$POLARIS_REALM"
[ -n "$S3_ENDPOINT" ] && set_env_value PARUSDB_S3_ENDPOINT "$S3_ENDPOINT"
[ -n "$S3_REGION" ] && set_env_value PARUSDB_S3_REGION "$S3_REGION"
[ -n "$S3_BUCKET" ] && set_env_value PARUSDB_S3_BUCKET "$S3_BUCKET"
[ -n "$S3_ACCESS_KEY_ID" ] && set_env_value PARUSDB_S3_ACCESS_KEY_ID "$S3_ACCESS_KEY_ID"
[ -n "$S3_SECRET_ACCESS_KEY" ] && set_env_value PARUSDB_S3_SECRET_ACCESS_KEY "$S3_SECRET_ACCESS_KEY"

# Valeurs par défaut pour toute clé restée vide.
for var in PARUSDB_DLT_IMAGE PARUSDB_DLT_NETWORK PARUSDB_DLT_STATE_VOLUME \
           PARUSDB_DLT_POLL_SECONDS PARUSDB_DLT_MAX_PARALLEL \
           PARUSDB_DLT_RUN_TIMEOUT_SECONDS PARUSDB_DB_HOST PARUSDB_DB_PORT \
           PARUSDB_DB_NAME PARUSDB_DB_USER PARUSDB_POLARIS_URI \
           PARUSDB_POLARIS_REALM PARUSDB_ICEBERG_CATALOG_NAME \
           PARUSDB_S3_BUCKET PARUSDB_S3_ENDPOINT PARUSDB_S3_REGION; do
    ensure_from_example "$var"
done

DB_ROLE=$(get_env_value PARUSDB_DB_USER)
DB_PASSWORD=$(get_env_value PARUSDB_DB_PASSWORD)
DB_IMAGE=$(get_env_value PARUSDB_DLT_IMAGE)
DB_NETWORK=$(get_env_value PARUSDB_DLT_NETWORK)

echo "===> Création du rôle PostgreSQL '$DB_ROLE' (moindre privilège)..."
docker exec -i supabase-db psql -U supabase_admin -d postgres \
    -v ON_ERROR_STOP=1 \
    -v db_role="$DB_ROLE" \
    -v db_password="$DB_PASSWORD" \
    < "$SCRIPT_DIR/sql/01-dlt-role.sql" >/dev/null
echo "    rôle '$DB_ROLE' prêt"

# Le schéma applicatif porte les politiques RLS TO parus_dlt (section
# connectors) : application idempotente après la création du rôle.
echo "===> Application du schéma applicatif (politiques RLS du rôle)..."
docker exec -i supabase-db psql -U supabase_admin -d postgres \
    < "$APP_SQL" >/dev/null
echo "    schéma connectors à jour"

echo "===> Construction de l'image du runner ($DB_IMAGE)..."
docker compose build 2>/dev/null || docker build -t "$DB_IMAGE" .

if [ "$SKIP_START" = "1" ]; then
    echo ""
    echo "Préparation terminée (--skip-start : ordonnanceur non démarré)."
    echo "Démarrage manuel : sh run.sh start"
    exit 0
fi

echo "===> Démarrage de l'ordonnanceur..."
docker compose up -d --wait
echo "    ordonnanceur démarré et sain"

echo "===> Vérification du runner (catalogue des sources)..."
docker run --rm --network "$DB_NETWORK" \
    "$DB_IMAGE" python -m runner.main catalog >/dev/null \
    && echo "    catalogue des sources résolu" \
    || fail "le runner ne démarre pas : inspectez 'sh run.sh build'"

echo ""
echo "Le moteur ELT dlt est prêt."
echo "  Image               : $DB_IMAGE"
echo "  Ordonnanceur        : parus-dlt-scheduler (conteneur jetable par run)"
echo "  État des pipelines  : volume '$(get_env_value PARUSDB_DLT_STATE_VOLUME)'"
echo "  Rôle PostgreSQL     : $DB_ROLE (schéma connectors uniquement)"
echo "  Destination         : Iceberg (Polaris, credentials RustFS vendus)"
echo ""
echo "Étape suivante : créer un pipeline dans l'interface (menu Connecteurs)."
