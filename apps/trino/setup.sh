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
#   3. durcissement (spec fonctionnelle § « Intégration Technique » (durcissement Trino)) : keystore TLS autosigné,
#      config.properties (HTTPS + authentification password file + secret
#      interne), comptes de service bcrypt (BFF, mcp-trino) et règles
#      d'access control de bootstrap — l'application régénère ensuite
#      password.db/rules.json depuis iam.grants (TRINO_SECURITY_DIR) ;
#   4. démarrage de la stack compose ;
#   5. génération des bindings de catalogues : un fichier
#      catalog/<catalogue>.properties par catalogue Polaris (le nom du fichier
#      est le nom du catalogue Trino — on requête `SELECT … FROM dev…`, pas
#      `FROM polaris…`). Le catalogue par défaut et le catalogue système
#      sont générés ici ; les autres le sont par l'application à leur
#      création ;
#   6. test de bout en bout : lecture des schémas de chaque catalogue.
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

# Polaris peut être « sain » alors que RustFS est éteint (santé HTTP
# superficielle, découverte après un redémarrage machine) : Trino en a besoin
# pour lire et écrire les fichiers Iceberg.
docker ps --filter name=supabase-rustfs --format '{{.Names}}' 2>/dev/null | grep -q . \
    || fail "le service RustFS de la stack Supabase n'est pas démarré (cd ../supabase && sh run.sh start)"

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
POLARIS_SYSTEM_CATALOG=$(read_env_var "$POLARIS_ENV" POLARIS_SYSTEM_CATALOG)
POLARIS_S3_ENDPOINT=$(read_env_var "$POLARIS_ENV" S3_ENDPOINT)
POLARIS_S3_REGION=$(read_env_var "$POLARIS_ENV" S3_REGION)

[ -n "$POLARIS_ROOT_CLIENT_ID" ] || fail "POLARIS_ROOT_CLIENT_ID absent de apps/polaris/.env"
[ -n "$POLARIS_ROOT_CLIENT_SECRET" ] || fail "POLARIS_ROOT_CLIENT_SECRET absent de apps/polaris/.env"

set_env_value POLARIS_CLIENT_ID "$POLARIS_ROOT_CLIENT_ID"
set_env_value POLARIS_CLIENT_SECRET "$POLARIS_ROOT_CLIENT_SECRET"
[ -n "$POLARIS_REALM_VAL" ] && set_env_value POLARIS_REALM "$POLARIS_REALM_VAL"
[ -n "$POLARIS_DEFAULT_CATALOG" ] && set_env_value POLARIS_CATALOG_NAME "$POLARIS_DEFAULT_CATALOG"
[ -n "$POLARIS_SYSTEM_CATALOG" ] && set_env_value POLARIS_SYSTEM_CATALOG "$POLARIS_SYSTEM_CATALOG"
[ -n "$POLARIS_S3_ENDPOINT" ] && set_env_value S3_ENDPOINT "$POLARIS_S3_ENDPOINT"
[ -n "$POLARIS_S3_REGION" ] && set_env_value S3_REGION "$POLARIS_S3_REGION"

# Valeurs par défaut pour toute clé restée vide.
for var in POLARIS_URI POLARIS_CATALOG_NAME POLARIS_SYSTEM_CATALOG POLARIS_REALM S3_ENDPOINT S3_REGION TRINO_PORT TRINO_HTTPS_PORT TRINO_SERVICE_USER TRINO_MCP_USER TRINO_OPS_USER; do
    ensure_from_example "$var"
done

POLARIS_CATALOG_NAME=$(get_env_value POLARIS_CATALOG_NAME)
POLARIS_SYSTEM_CATALOG=$(get_env_value POLARIS_SYSTEM_CATALOG)

# Génère catalog/<nom>.properties : le nom du fichier (donc du catalogue Trino)
# est le nom du catalogue Polaris, et le warehouse pointe sur ce même catalogue
# — on requête `SELECT … FROM dev.<schéma>…`, pas `FROM polaris…`. Le contenu
# reprend lib/lakehouse.ts (trinoBindingFileContent) : seuls l'URI, le realm et
# les credentials restent substitués par l'environnement du conteneur.
generate_binding() {
    name="$1"
    mkdir -p "$SCRIPT_DIR/catalog"
    cat > "$SCRIPT_DIR/catalog/$name.properties" <<PROPS
#
# Catalogue Trino "$name" : Iceberg REST -> Polaris (généré par setup.sh).
# Chargé par Trino à son prochain (re)démarrage — automatique après création
# via l'application (dès qu'aucune requête n'est en cours).
#
connector.name=iceberg
iceberg.catalog.type=rest
iceberg.rest-catalog.uri=\${ENV:POLARIS_URI}
iceberg.rest-catalog.security=OAUTH2
iceberg.rest-catalog.oauth2.credential=\${ENV:CLIENT_ID}:\${ENV:CLIENT_SECRET}
iceberg.rest-catalog.oauth2.scope=PRINCIPAL_ROLE:ALL
iceberg.rest-catalog.warehouse=$name
iceberg.rest-catalog.vended-credentials-enabled=true
iceberg.rest-catalog.http-headers=Polaris-Realm: \${ENV:POLARIS_REALM}
fs.s3.enabled=true
s3.endpoint=\${ENV:S3_ENDPOINT}
s3.path-style-access=true
s3.region=\${ENV:S3_REGION}
PROPS
    echo "    binding '$name' généré (catalog/$name.properties)"
}

echo "===> Génération des bindings de catalogues..."
rm -f "$SCRIPT_DIR/catalog/polaris.properties" # ancien binding générique
if [ -n "$POLARIS_SYSTEM_CATALOG" ]; then
    generate_binding "$POLARIS_SYSTEM_CATALOG"
else
    echo "    POLARIS_SYSTEM_CATALOG vide : aucun binding système généré"
fi
if [ -n "$POLARIS_CATALOG_NAME" ]; then
    generate_binding "$POLARIS_CATALOG_NAME"
else
    echo "    POLARIS_CATALOG_NAME vide : aucun binding par défaut généré"
fi

# ---------------------------------------------------------------------------
# Durcissement Trino (spec fonctionnelle § « Intégration Technique » (durcissement Trino)) : HTTPS autosigné + authenticator
# password file (bcrypt) + access control JSON. Le port HTTP clair n'est plus
# publié : l'authentification exige TLS. Les comptes applicatifs et les
# règles issues de iam.grants sont régénérés par l'application (apps/nextjs,
# TRINO_SECURITY_DIR) ; ce setup ne pose que les comptes de service statiques
# et les règles de bootstrap.
# ---------------------------------------------------------------------------
echo "===> Durcissement Trino (HTTPS + authentification + access control)..."

# Secrets de service : générés une seule fois, conservés entre les relances.
generate_secret() {
    if [ -z "$(get_env_value "$1")" ]; then
        set_env_value "$1" "$(openssl rand -hex 24)"
        echo "    $1 généré"
    fi
}
generate_secret TRINO_SERVICE_PASSWORD
generate_secret TRINO_MCP_PASSWORD
generate_secret TRINO_OPS_PASSWORD
generate_secret TRINO_INTERNAL_SHARED_SECRET

TRINO_SERVICE_USER=$(get_env_value TRINO_SERVICE_USER)
TRINO_MCP_USER=$(get_env_value TRINO_MCP_USER)
TRINO_OPS_USER=$(get_env_value TRINO_OPS_USER)
[ -n "$TRINO_SERVICE_USER" ] || TRINO_SERVICE_USER="parus-app"
[ -n "$TRINO_MCP_USER" ] || TRINO_MCP_USER="parus-mcp"
[ -n "$TRINO_OPS_USER" ] || TRINO_OPS_USER="parus-ops"
TRINO_HTTPS_PORT_VAL=$(get_env_value TRINO_HTTPS_PORT)
[ -n "$TRINO_HTTPS_PORT_VAL" ] || TRINO_HTTPS_PORT_VAL="8453"

mkdir -p "$SCRIPT_DIR/etc" "$SCRIPT_DIR/security"

# Keystore TLS autosigné (PEM clé + certificat, accepté nativement par
# Trino). Conservé s'il existe : les clients ne valident pas le certificat
# (réseau privé — friction documentée dans /admin/informations).
# SANs obligatoires : les clients Go (mcp-trino) valident le certificat via
# SSL_CERT_FILE et ne regardent que les SANs — DNS:trino (réseau Docker),
# DNS:localhost (clients hôte), IP:127.0.0.1. Le certificat public seul est
# exporté en etc/parus-trino.crt pour être monté dans mcp-trino (jamais la
# clé).
if [ ! -f "$SCRIPT_DIR/etc/keystore.pem" ]; then
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
        -subj "/CN=parus-trino" \
        -addext "subjectAltName=DNS:parus-trino,DNS:trino,DNS:localhost,IP:127.0.0.1" \
        -keyout "$SCRIPT_DIR/etc/keystore.key" \
        -out "$SCRIPT_DIR/etc/keystore.crt" 2>/dev/null \
        || fail "la génération du keystore TLS a échoué (openssl requis)"
    cat "$SCRIPT_DIR/etc/keystore.key" "$SCRIPT_DIR/etc/keystore.crt" \
        > "$SCRIPT_DIR/etc/keystore.pem"
    rm -f "$SCRIPT_DIR/etc/keystore.key"
    echo "    keystore TLS autosigné généré (etc/keystore.pem)"
    # Le keystore est bind-monté en fichier unique : une régénération crée
    # un nouvel inode que le conteneur existant ne voit pas (il continue de
    # servir l'ancien certificat). Le conteneur sera recréé au démarrage.
    KEYSTORE_REGENERATED=1
fi
chmod 600 "$SCRIPT_DIR/etc/keystore.pem"
chmod 644 "$SCRIPT_DIR/etc/keystore.crt"

# config.properties : base extraite de l'image (version épinglée du compose)
# + propriétés de durcissement. Le secret interne est OBLIGATOIRE dès qu'une
# authentification est activée — même en mono-noeud (communication interne
# discovery), sinon Trino refuse de démarrer.
TRINO_IMAGE=$(grep -m1 'image:' "$SCRIPT_DIR/docker-compose.yml" | awk '{print $2}')
docker run --rm --entrypoint cat "$TRINO_IMAGE" /etc/trino/config.properties \
    > "$SCRIPT_DIR/etc/config.properties" \
    || fail "lecture de la config de l'image $TRINO_IMAGE impossible"
cat >> "$SCRIPT_DIR/etc/config.properties" <<PROPS

# Durcissement ParusDB (spec fonctionnelle § « Intégration Technique » (durcissement Trino)) — HTTPS + authentification.
http-server.https.enabled=true
http-server.https.port=8443
http-server.https.keystore.path=etc/keystore.pem
http-server.authentication.type=PASSWORD
internal-communication.shared-secret=$(get_env_value TRINO_INTERNAL_SHARED_SECRET)
PROPS
chmod 600 "$SCRIPT_DIR/etc/config.properties"

# Authenticator password file : rechargé toutes les 5 s (défaut Trino),
# sans redémarrage — l'application ajoute/retire les comptes applicatifs.
cat > "$SCRIPT_DIR/etc/password-authenticator.properties" <<PROPS
password-authenticator.name=file
file.password-file=/etc/trino/security/password.db
PROPS

# Access control par règles JSON : rechargé toutes les 5 s sans redémarrage
# (révocation d'un grant = refus immédiat). Le fichier rules.json est
# régénéré en entier par l'application ; ce bootstrap ne couvre que les
# comptes de service statiques (BFF non contraint — la garde RBAC est
# applicative côté éditeur SQL ; mcp-trino en lecture seule globale ; son
# périmètre utilisateur est appliqué par le BFF, ce serveur MCP est global).
cat > "$SCRIPT_DIR/etc/access-control.properties" <<PROPS
access-control.name=file
security.config-file=/etc/trino/security/rules.json
security.refresh-period=5s
PROPS

# bcrypt au format Trino ($2y$, cost 10 ≥ 8) : conteneur éphémère htpasswd
# (même pattern que les busybox des reset.sh — aucun outil bcrypt fiable sur
# l'hôte, busybox cryptpw ne supporte pas bcrypt).
htpasswd_hash() {
    docker run --rm httpd:2-alpine htpasswd -bnB -C 10 "$1" "$2" \
        || fail "la génération bcrypt a échoué (image httpd:2-alpine requise)"
}

# password.db : les lignes des comptes applicatifs (autres utilisateurs,
# gérées par l'application) sont préservées ; seules les lignes des
# comptes de service sont mises à jour.
touch "$SCRIPT_DIR/security/password.db"
grep -v "^${TRINO_SERVICE_USER}:" "$SCRIPT_DIR/security/password.db" \
    | grep -v "^${TRINO_MCP_USER}:" \
    | grep -v "^${TRINO_OPS_USER}:" > "$SCRIPT_DIR/security/password.db.tmp" || true
htpasswd_hash "$TRINO_SERVICE_USER" "$(get_env_value TRINO_SERVICE_PASSWORD)" \
    >> "$SCRIPT_DIR/security/password.db.tmp"
htpasswd_hash "$TRINO_MCP_USER" "$(get_env_value TRINO_MCP_PASSWORD)" \
    >> "$SCRIPT_DIR/security/password.db.tmp"
htpasswd_hash "$TRINO_OPS_USER" "$(get_env_value TRINO_OPS_PASSWORD)" \
    >> "$SCRIPT_DIR/security/password.db.tmp"
mv "$SCRIPT_DIR/security/password.db.tmp" "$SCRIPT_DIR/security/password.db"
chmod 600 "$SCRIPT_DIR/security/password.db"

# rules.json de bootstrap (l'application en devient propriitaire ensuite et
# le régénère en entier à chaque modification des grants/comptes).
if [ ! -f "$SCRIPT_DIR/security/rules.json" ]; then
    cat > "$SCRIPT_DIR/security/rules.json" <<EOF
{
  "catalogs": [
    { "user": "^${TRINO_SERVICE_USER}\$", "catalog": "^system\$", "allow": "read-only" },
    { "user": "^${TRINO_SERVICE_USER}\$", "allow": "none" },
    { "user": "^${TRINO_MCP_USER}\$", "allow": "read-only" },
    { "user": "^${TRINO_OPS_USER}\$", "allow": "all" }
  ]
}
EOF
    chmod 600 "$SCRIPT_DIR/security/rules.json"
    echo "    règles d'access control de bootstrap générées (security/rules.json)"
fi
echo "    comptes de service Trino : $TRINO_SERVICE_USER (BFF, limité à system), $TRINO_MCP_USER (mcp-trino, lecture seule), $TRINO_OPS_USER (outillage, accès complet)"

if [ "$SKIP_START" = "1" ]; then
    echo ""
    echo "Préparation terminée (--skip-start : stack non démarrée)."
    echo "Démarrage manuel : sh run.sh start"
    exit 0
fi

echo "===> Démarrage de la stack Trino..."
if [ "${KEYSTORE_REGENERATED:-0}" = "1" ]; then
    docker compose up -d --force-recreate --no-deps --wait
else
    docker compose up -d --wait
fi
echo "    trino est démarré et sain"

echo "===> Test de bout en bout (HTTPS + authentification, schémas de chaque catalogue)..."
OPS_PW=$(get_env_value TRINO_OPS_PASSWORD)
for catalog in $POLARIS_SYSTEM_CATALOG $POLARIS_CATALOG_NAME; do
    docker compose exec -T -e TRINO_PASSWORD="$OPS_PW" trino trino \
        --server https://localhost:8443 --user "$TRINO_OPS_USER" \
        --password --insecure \
        --execute "SHOW SCHEMAS FROM $catalog"
done

echo ""
echo "Trino est prêt."
echo "  UI web + API HTTPS  : https://localhost:$(get_env_value TRINO_HTTPS_PORT)"
echo "                        (certificat autosigné, authentification obligatoire)"
echo "  Catalogues Trino    : $POLARIS_SYSTEM_CATALOG (système), $POLARIS_CATALOG_NAME (environnement)"
echo "  CLI SQL             : sh run.sh cli"
echo ""
echo "Les comptes de service (BFF $TRINO_SERVICE_USER limité à system, mcp-trino $TRINO_MCP_USER en lecture seule, outillage $TRINO_OPS_USER accès complet) sont"
echo "dans apps/trino/.env — synchronisés vers les apps par le setup racine."
echo ""
echo "Exemple (compte outillage — les requêtes des utilisateurs passent par leurs comptes de rôle) :"
echo "  docker compose exec -T -e TRINO_PASSWORD=\$TRINO_OPS_PASSWORD trino trino --server https://localhost:8443 --user $TRINO_OPS_USER --password --insecure --execute \"SELECT * FROM $POLARIS_CATALOG_NAME.information_schema.tables\""
