#!/bin/sh
#
# Bootstrap de Trino pour ParusDB.
#
# Prérequis : stack Supabase (apps/supabase) et Apache Polaris (apps/polaris)
# démarrés et sains.
#
# Étapes (toutes idempotentes, le script est relançable sans risque) :
#   1. vérification des prérequis (docker, compose, Polaris joignable) ;
#   2. création de .env depuis .env.example si absent, import des credentials
#      Polaris depuis apps/polaris/.env ;
#   3. démarrage de la stack compose ;
#   4. test de bout en bout : lecture des schémas du catalogue polaris.
#
# Usage :
#   sh setup.sh               # bootstrap complet puis démarrage
#   sh setup.sh --skip-start  # tout préparer sans démarrer la stack
#   sh setup.sh -h | --help   # aide
#

set -e

cd "$(dirname "$0")"

SCRIPT_DIR=$(pwd)
POLARIS_ENV="$SCRIPT_DIR/../polaris/.env"
LOCAL_ENV="$SCRIPT_DIR/.env"

print_help() {
    cat <<EOF
Usage: $(basename "$0") [options]

Options:
      --skip-start   Préparer tout (.env, credentials) sans démarrer la stack
  -h, --help          Afficher cette aide et sortir

Prérequis : stack Supabase et Polaris démarrées
(cd apps/supabase && sh run.sh start ; cd apps/polaris && sh run.sh start)
EOF
}

fail() {
    echo "ERREUR : $1" >&2
    exit 1
}

# Lecture d'une variable KEY=VALUE dans un fichier .env (sans le sourcer).
read_env_var() {
    [ -f "$1" ] || return 0
    grep "^$2=" "$1" | head -n 1 | cut -d= -f2- | tr -d "\r" | sed -e "s/^\"//" -e "s/\"$//"
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
docker network inspect supabase_default >/dev/null 2>&1 \
    || fail "réseau Docker supabase_default introuvable : démarrez la stack Supabase"

[ -f "$POLARIS_ENV" ] || fail "apps/polaris/.env introuvable : lancez d'abord le setup de Polaris"

docker ps --filter name=parus-polaris --format '{{.Names}}' 2>/dev/null | grep -q . \
    || fail "le conteneur parus-polaris n'est pas démarré (cd ../polaris && sh run.sh start)"

POLARIS_MANAGEMENT_PORT=$(read_env_var "$POLARIS_ENV" POLARIS_MANAGEMENT_PORT)
POLARIS_MANAGEMENT_PORT=${POLARIS_MANAGEMENT_PORT:-8182}
curl -s --max-time 10 -o /dev/null -f "http://localhost:$POLARIS_MANAGEMENT_PORT/q/health" \
    || fail "l'API de Polaris ne répond pas (http://localhost:$POLARIS_MANAGEMENT_PORT/q/health) : démarrez Polaris"

echo "===> Préparation de .env..."
if [ ! -f "$LOCAL_ENV" ]; then
    cp "$SCRIPT_DIR/.env.example" "$LOCAL_ENV"
    echo "    .env créé depuis .env.example"
fi

# Import depuis apps/polaris/.env : credentials du principal, realm, catalogue,
# endpoints RustFS. Toujours resynchronisés.
POLARIS_ROOT_CLIENT_ID=$(read_env_var "$POLARIS_ENV" POLARIS_ROOT_CLIENT_ID)
POLARIS_ROOT_CLIENT_SECRET=$(read_env_var "$POLARIS_ENV" POLARIS_ROOT_CLIENT_SECRET)
POLARIS_REALM_VAL=$(read_env_var "$POLARIS_ENV" POLARIS_REALM)
POLARIS_DEFAULT_CATALOG=$(read_env_var "$POLARIS_ENV" POLARIS_DEFAULT_CATALOG)
POLARIS_S3_ENDPOINT=$(read_env_var "$POLARIS_ENV" S3_ENDPOINT)
POLARIS_S3_REGION=$(read_env_var "$POLARIS_ENV" S3_REGION)

[ -n "$POLARIS_ROOT_CLIENT_ID" ] || fail "POLARIS_ROOT_CLIENT_ID absent de apps/polaris/.env"
[ -n "$POLARIS_ROOT_CLIENT_SECRET" ] || fail "POLARIS_ROOT_CLIENT_SECRET absent de apps/polaris/.env"

set_env_value POLARIS_CLIENT_ID "$POLARIS_ROOT_CLIENT_ID"
set_env_value POLARIS_CLIENT_SECRET "$POLARIS_ROOT_CLIENT_SECRET"
[ -n "$POLARIS_REALM_VAL" ] && set_env_value POLARIS_REALM "$POLARIS_REALM_VAL"
[ -n "$POLARIS_DEFAULT_CATALOG" ] && set_env_value POLARIS_CATALOG_NAME "$POLARIS_DEFAULT_CATALOG"
[ -n "$POLARIS_S3_ENDPOINT" ] && set_env_value S3_ENDPOINT "$POLARIS_S3_ENDPOINT"
[ -n "$POLARIS_S3_REGION" ] && set_env_value S3_REGION "$POLARIS_S3_REGION"

# Valeurs par défaut pour toute clé restée vide.
for var in POLARIS_URI POLARIS_CATALOG_NAME POLARIS_REALM S3_ENDPOINT S3_REGION TRINO_PORT; do
    ensure_from_example "$var"
done

POLARIS_CATALOG_NAME=$(get_env_value POLARIS_CATALOG_NAME)

if [ "$SKIP_START" = "1" ]; then
    echo ""
    echo "Préparation terminée (--skip-start : stack non démarrée)."
    echo "Démarrage manuel : sh run.sh start"
    exit 0
fi

echo "===> Démarrage de la stack Trino..."
docker compose up -d --wait
echo "    trino est démarré et sain"

echo "===> Test de bout en bout (schémas du catalogue '$POLARIS_CATALOG_NAME' via Polaris)..."
docker compose exec -T trino trino --execute "SHOW SCHEMAS FROM polaris"

echo ""
echo "Trino est prêt."
echo "  UI web + API HTTP   : http://localhost:$(get_env_value TRINO_PORT)"
echo "  Catalogue Trino     : polaris (warehouse Polaris : $POLARIS_CATALOG_NAME)"
echo "  CLI SQL             : sh run.sh cli"
echo ""
echo "Exemple :"
echo "  docker compose exec -T trino trino --execute \"SELECT 1\""
