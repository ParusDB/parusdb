#!/bin/sh
#
# Bootstrap d'Apache Polaris pour ParusDB.
#
# Prérequis : stack Supabase démarrée avec l'override RustFS
#   (cd apps/supabase && sh run.sh config add rustfs && sh run.sh start).
#
# Étapes (toutes idempotentes, le script est relançable sans risque) :
#   1. vérification des prérequis (docker, compose, openssl, curl, jq) ;
#   2. création de .env depuis .env.example si absent, import des credentials
#      RustFS et du port Postgres depuis apps/supabase/.env, génération des
#      secrets manquants ;
#   3. création du rôle et de la base PostgreSQL dans le Postgres Supabase
#      (sql/01-init-cluster.sql + sql/02-init-database.sql) ;
#   4. création du bucket RustFS du lakehouse ;
#   5. génération des clés RSA du token broker (volumes/token-keys) ;
#   6. démarrage de la stack compose (polaris-bootstrap puis polaris) ;
#   7. création du catalogue d'environnement par défaut (ex. `dev`) via l'API
#      d'administration, avec grant CATALOG_MANAGE_CONTENT sur catalog_admin ;
#
# Usage :
#   sh setup.sh               # bootstrap complet puis démarrage
#   sh setup.sh --skip-start  # tout préparer sans démarrer la stack
#   sh setup.sh -h | --help   # aide
#

set -e

cd "$(dirname "$0")"

SCRIPT_DIR=$(pwd)
SUPABASE_ENV="$SCRIPT_DIR/../supabase/.env"
LOCAL_ENV="$SCRIPT_DIR/.env"

print_help() {
    cat <<EOF
Usage: $(basename "$0") [options]

Options:
      --skip-start   Préparer tout (secrets, base, bucket) sans démarrer la stack
  -h, --help          Afficher cette aide et sortir

Prérequis : stack Supabase démarrée avec l'override RustFS
(cd apps/supabase && sh run.sh config add rustfs && sh run.sh start)
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

# Écrit (ou remplace) une variable dans .env.
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

# Complète une variable absente ou vide avec sa valeur par défaut de .env.example.
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
command -v curl >/dev/null 2>&1 || fail "curl est requis"
command -v jq >/dev/null 2>&1 || fail "jq est requis"

[ -f "$SUPABASE_ENV" ] || fail "apps/supabase/.env introuvable : lancez d'abord le setup de la stack Supabase"

docker ps --filter name=supabase-db --format '{{.Names}}' 2>/dev/null | grep -q . \
    || fail "le conteneur supabase-db n'est pas démarré (cd apps/supabase && sh run.sh start)"
docker ps --filter name=supabase-rustfs --format '{{.Names}}' 2>/dev/null | grep -q . \
    || fail "le service RustFS de la stack Supabase n'est pas démarré (cd apps/supabase && sh run.sh config add rustfs && sh run.sh start)"
docker network inspect supabase_default >/dev/null 2>&1 \
    || fail "réseau Docker supabase_default introuvable : démarrez la stack Supabase"

echo "===> Préparation de .env..."
if [ ! -f "$LOCAL_ENV" ]; then
    cp "$SCRIPT_DIR/.env.example" "$LOCAL_ENV"
    echo "    .env créé depuis .env.example"
fi

# Secrets générés s'ils sont absents.
if [ -z "$(get_env_value POLARIS_DB_PASSWORD)" ]; then
    set_env_value POLARIS_DB_PASSWORD "$(openssl rand -hex 24)"
    echo "    POLARIS_DB_PASSWORD généré"
fi
if [ -z "$(get_env_value POLARIS_ROOT_CLIENT_SECRET)" ]; then
    set_env_value POLARIS_ROOT_CLIENT_SECRET "$(openssl rand -hex 24)"
    echo "    POLARIS_ROOT_CLIENT_SECRET généré"
fi

# Import depuis la stack Supabase : credentials RustFS et port Postgres.
# Toujours resynchronisés : une rotation côté Supabase est répercutée ici.
MINIO_USER=$(read_env_var "$SUPABASE_ENV" MINIO_ROOT_USER)
MINIO_PASSWORD=$(read_env_var "$SUPABASE_ENV" MINIO_ROOT_PASSWORD)
POSTGRES_PORT=$(read_env_var "$SUPABASE_ENV" POSTGRES_PORT)
[ -n "$MINIO_USER" ] || fail "MINIO_ROOT_USER absent de apps/supabase/.env"
[ -n "$MINIO_PASSWORD" ] || fail "MINIO_ROOT_PASSWORD absent de apps/supabase/.env"
set_env_value S3_ACCESS_KEY_ID "$MINIO_USER"
set_env_value S3_SECRET_ACCESS_KEY "$MINIO_PASSWORD"
if [ -n "$POSTGRES_PORT" ]; then
    set_env_value POLARIS_DB_PORT "$POSTGRES_PORT"
fi

# Valeurs par défaut pour toute clé restée vide.
for var in POLARIS_DB_HOST POLARIS_DB_NAME POLARIS_DB_USER POLARIS_REALM \
           POLARIS_ROOT_CLIENT_ID POLARIS_API_PORT POLARIS_MANAGEMENT_PORT \
           POLARIS_DEFAULT_CATALOG S3_REGION POLARIS_S3_BUCKET S3_ENDPOINT \
           S3_ENDPOINT_INTERNAL; do
    ensure_from_example "$var"
done

# Relecture des valeurs actives.
POLARIS_DB_NAME=$(get_env_value POLARIS_DB_NAME)
POLARIS_DB_USER=$(get_env_value POLARIS_DB_USER)
POLARIS_DB_PASSWORD=$(get_env_value POLARIS_DB_PASSWORD)
POLARIS_API_PORT=$(get_env_value POLARIS_API_PORT)
POLARIS_MANAGEMENT_PORT=$(get_env_value POLARIS_MANAGEMENT_PORT)
POLARIS_REALM=$(get_env_value POLARIS_REALM)
POLARIS_ROOT_CLIENT_ID=$(get_env_value POLARIS_ROOT_CLIENT_ID)
POLARIS_ROOT_CLIENT_SECRET=$(get_env_value POLARIS_ROOT_CLIENT_SECRET)
POLARIS_DEFAULT_CATALOG=$(get_env_value POLARIS_DEFAULT_CATALOG)
POLARIS_S3_BUCKET=$(get_env_value POLARIS_S3_BUCKET)
S3_ACCESS_KEY_ID=$(get_env_value S3_ACCESS_KEY_ID)
S3_SECRET_ACCESS_KEY=$(get_env_value S3_SECRET_ACCESS_KEY)
S3_ENDPOINT=$(get_env_value S3_ENDPOINT)
S3_ENDPOINT_INTERNAL=$(get_env_value S3_ENDPOINT_INTERNAL)
S3_REGION=$(get_env_value S3_REGION)

echo "===> Création du rôle et de la base PostgreSQL (Postgres Supabase)..."
# L'image Supabase donne le rôle SUPERUSER à `supabase_admin` (pas `postgres`).
docker exec -i supabase-db psql -U supabase_admin \
    -v ON_ERROR_STOP=1 \
    -v db_role="$POLARIS_DB_USER" \
    -v db_name="$POLARIS_DB_NAME" \
    -v db_password="$POLARIS_DB_PASSWORD" \
    < "$SCRIPT_DIR/sql/01-init-cluster.sql" >/dev/null

# Initialisation de la base cible : schéma applicatif + search_path par défaut
# (le bootstrap Polaris ne crée pas le schéma lui-même).
docker exec -i supabase-db psql -U supabase_admin -d "$POLARIS_DB_NAME" \
    -v ON_ERROR_STOP=1 \
    -v db_role="$POLARIS_DB_USER" \
    -v db_name="$POLARIS_DB_NAME" \
    < "$SCRIPT_DIR/sql/02-init-database.sql" >/dev/null
echo "    base '$POLARIS_DB_NAME' et rôle '$POLARIS_DB_USER' prêts"

echo "===> Création du bucket RustFS '$POLARIS_S3_BUCKET'..."
docker run --rm -i --network supabase_default --entrypoint /bin/sh rustfs/rc -s <<RC
set -e
rc alias set parus-rustfs "$S3_ENDPOINT_INTERNAL" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
rc mb --ignore-existing "parus-rustfs/$POLARIS_S3_BUCKET"
RC
echo "    bucket prêt"

echo "===> Clés RSA du token broker OAuth2..."
mkdir -p "$SCRIPT_DIR/volumes/token-keys"
if [ ! -f "$SCRIPT_DIR/volumes/token-keys/private.key" ] || [ ! -f "$SCRIPT_DIR/volumes/token-keys/public.key" ]; then
    openssl genpkey -algorithm RSA -out "$SCRIPT_DIR/volumes/token-keys/private.key" -pkeyopt rsa_keygen_bits:2048 >/dev/null 2>&1
    openssl rsa -in "$SCRIPT_DIR/volumes/token-keys/private.key" -pubout -out "$SCRIPT_DIR/volumes/token-keys/public.key" >/dev/null 2>&1
    # Lisible par le conteneur (utilisateur non-root polaris) : le dossier est
    # gitignoré et propre à la machine hôte.
    chmod 644 "$SCRIPT_DIR/volumes/token-keys/private.key" "$SCRIPT_DIR/volumes/token-keys/public.key"
    echo "    paire de clés générée (volumes/token-keys)"
else
    echo "    paire de clés déjà présente (volumes/token-keys)"
fi

if [ "$SKIP_START" = "1" ]; then
    echo ""
    echo "Préparation terminée (--skip-start : stack non démarrée)."
    echo "Démarrage manuel : sh run.sh start"
    exit 0
fi

echo "===> Démarrage de la stack Polaris..."
docker compose up -d --wait
echo "    polaris est démarré et sain"

if [ -z "$POLARIS_DEFAULT_CATALOG" ]; then
    echo "===> Aucun catalogue par défaut défini (POLARIS_DEFAULT_CATALOG vide)"
    echo "    les catalogues seront créés par l'application (spec §Data Lakehouse)"
else
    echo "===> Création du catalogue '$POLARIS_DEFAULT_CATALOG'..."
    API="http://localhost:${POLARIS_API_PORT}"
    TOKEN=$(curl -s --max-time 30 -X POST "$API/api/catalog/v1/oauth/tokens" \
        -d grant_type=client_credentials \
        -d "client_id=$POLARIS_ROOT_CLIENT_ID" \
        -d "client_secret=$POLARIS_ROOT_CLIENT_SECRET" \
        -d scope=PRINCIPAL_ROLE:ALL | jq -r '.access_token // empty')
    [ -n "$TOKEN" ] || fail "impossible d'obtenir un jeton OAuth2 auprès de Polaris (vérifiez POLARIS_ROOT_CLIENT_ID et POLARIS_ROOT_CLIENT_SECRET dans .env)"

    CODE=$(curl -s --max-time 30 -o /dev/null -w '%{http_code}' \
        "$API/api/management/v1/catalogs/$POLARIS_DEFAULT_CATALOG" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Polaris-Realm: $POLARIS_REALM")

    if [ "$CODE" = "404" ]; then
        # polaris.config.drop-with-purge.enabled : les moteurs (Trino) émettent
        # leurs DROP avec purgeRequested=true ; sans cette propriété catalogue,
        # Polaris les refuse (HTTP 403) et les fichiers Iceberg restent orphelins.
        PAYLOAD=$(cat <<JSON
{"catalog": {"name": "$POLARIS_DEFAULT_CATALOG", "type": "INTERNAL", "readOnly": false, "properties": {"default-base-location": "s3://$POLARIS_S3_BUCKET/$POLARIS_DEFAULT_CATALOG", "polaris.config.drop-with-purge.enabled": "true"}, "storageConfigInfo": {"storageType": "S3", "allowedLocations": ["s3://$POLARIS_S3_BUCKET"], "endpoint": "$S3_ENDPOINT", "endpointInternal": "$S3_ENDPOINT_INTERNAL", "pathStyleAccess": true, "region": "$S3_REGION"}}}
JSON
)
        RESP=$(curl -s --max-time 30 -w '\n%{http_code}' \
            -X POST "$API/api/management/v1/catalogs" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Polaris-Realm: $POLARIS_REALM" \
            -H "Content-Type: application/json" \
            -d "$PAYLOAD")
        CODE=$(printf '%s' "$RESP" | tail -n 1)
        BODY=$(printf '%s' "$RESP" | sed '$d')
        case "$CODE" in
            200|201) echo "    catalogue '$POLARIS_DEFAULT_CATALOG' créé" ;;
            *) fail "échec de la création du catalogue '$POLARIS_DEFAULT_CATALOG' (HTTP $CODE) : $BODY" ;;
        esac
    elif [ "$CODE" = "200" ]; then
        echo "    le catalogue '$POLARIS_DEFAULT_CATALOG' existe déjà"
    else
        fail "réponse inattendue de l'API Polaris (HTTP $CODE) lors de la vérification du catalogue"
    fi

    # Grant d'administration au rôle catalog_admin du catalogue (idempotent) :
    # sans CATALOG_MANAGE_CONTENT, la création de tables avec délégation
    # d'écriture (CREATE_TABLE_STAGED_WITH_WRITE_DELEGATION) est refusée,
    # même au principal root. Étape « extra grants » du guide officiel.
    CODE=$(curl -s --max-time 30 -o /dev/null -w '%{http_code}' \
        -X PUT "$API/api/management/v1/catalogs/$POLARIS_DEFAULT_CATALOG/catalog-roles/catalog_admin/grants" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Polaris-Realm: $POLARIS_REALM" \
        -H "Content-Type: application/json" \
        -d '{"type": "catalog", "privilege": "CATALOG_MANAGE_CONTENT"}')
    case "$CODE" in
        200|201|204) echo "    grant CATALOG_MANAGE_CONTENT confirmé sur catalog_admin" ;;
        *) fail "échec du grant CATALOG_MANAGE_CONTENT (HTTP $CODE)" ;;
    esac
fi

echo ""
echo "Apache Polaris est prêt."
echo "  API Iceberg REST   : http://localhost:$POLARIS_API_PORT/api/catalog"
echo "  API Management     : http://localhost:$POLARIS_API_PORT/api/management/v1"
echo "  Santé / métriques  : http://localhost:$POLARIS_MANAGEMENT_PORT/q/health"
echo "  Realm              : $POLARIS_REALM (client root : $POLARIS_ROOT_CLIENT_ID, secret dans .env)"
echo "  Persistance        : base '$POLARIS_DB_NAME' du Postgres Supabase"
echo "  Object storage     : bucket '$POLARIS_S3_BUCKET' (RustFS)"
if [ -n "$POLARIS_DEFAULT_CATALOG" ]; then
    echo "  Catalogue          : $POLARIS_DEFAULT_CATALOG (base s3://$POLARIS_S3_BUCKET/$POLARIS_DEFAULT_CATALOG)"
fi
echo ""
echo "Étape suivante : configurer et démarrer Trino (cd ../trino && sh setup.sh)."
