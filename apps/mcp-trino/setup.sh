#!/bin/sh
#
# Bootstrap de mcp-trino pour ParusDB.
#
# Prérequis : stack Supabase (apps/supabase) et Trino (apps/trino) démarrés
# et sains. Le serveur mcp-trino vérifie lui-même la connexion Trino au
# démarrage et s'arrête si elle échoue.
#
# Étapes (toutes idempotentes, le script est relançable sans risque) :
#   1. vérification des prérequis (docker, compose, réseau, Trino joignable) ;
#   2. création de .env depuis .env.example si absent ;
#   3. démarrage de la stack compose ;
#   4. test de bout en bout : handshake MCP (initialize), liste des outils,
#      exécution de SELECT 1 via execute_query.
#
# Usage :
#   sh setup.sh               # bootstrap complet puis démarrage
#   sh setup.sh --skip-start  # tout préparer sans démarrer la stack
#   sh setup.sh -h | --help   # aide
#

set -e

cd "$(dirname "$0")"

SCRIPT_DIR=$(pwd)
LOCAL_ENV="$SCRIPT_DIR/.env"

print_help() {
    cat <<EOF
Usage: $(basename "$0") [options]

Options:
      --skip-start   Préparer tout (.env) sans démarrer la stack
  -h, --help          Afficher cette aide et sortir

Prérequis : stack Supabase et Trino démarrées
(cd apps/supabase && sh run.sh start ; cd apps/trino && sh run.sh start)
EOF
}

fail() {
    echo "ERREUR : $1" >&2
    exit 1
}

read_env_var() {
    [ -f "$1" ] || return 0
    grep "^$2=" "$1" | head -n 1 | cut -d= -f2- | tr -d "\r" | sed -e "s/^\"//" -e "s/\"$//"
}

get_env_value() {
    read_env_var "$LOCAL_ENV" "$1"
}

# Requête JSON-RPC vers l'endpoint MCP Streamable HTTP.
# $1 = corps JSON, $2 = fichier temporaire pour les en-têtes de réponse.
mcp_post() {
    curl -s --max-time 15 -o "$MCP_BODY_FILE" -D "$MCP_HEADERS_FILE" \
        -X POST "http://localhost:$MCP_HTTP_PORT/mcp" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        ${MCP_SESSION_HEADER:+"-H" "$MCP_SESSION_HEADER"} \
        -d "$1"
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
command -v curl >/dev/null 2>&1 || fail "curl est requis"
docker compose version >/dev/null 2>&1 || fail "le plugin docker compose est requis"
docker network inspect supabase_default >/dev/null 2>&1 \
    || fail "réseau Docker supabase_default introuvable : démarrez la stack Supabase"

docker ps --filter name=parus-trino --format '{{.Names}}' 2>/dev/null | grep -q . \
    || fail "le conteneur parus-trino n'est pas démarré (cd ../trino && sh run.sh start)"

TRINO_HTTPS_PORT_HOST=$(read_env_var "$SCRIPT_DIR/../trino/.env" TRINO_HTTPS_PORT)
TRINO_HTTPS_PORT_HOST=${TRINO_HTTPS_PORT_HOST:-8453}
curl -s --max-time 10 -o /dev/null -fk "https://localhost:$TRINO_HTTPS_PORT_HOST/v1/info" \
    || fail "l'API de Trino ne répond pas (https://localhost:$TRINO_HTTPS_PORT_HOST/v1/info) : démarrez Trino"

echo "===> Préparation de .env..."
if [ ! -f "$LOCAL_ENV" ]; then
    cp "$SCRIPT_DIR/.env.example" "$LOCAL_ENV"
    echo "    .env créé depuis .env.example"
fi

# Comptes de service Trino durci (rbac_refonte.md §9) : toujours resynchronisés
# depuis apps/trino/.env (générés par son setup).
TRINO_MCP_USER_VAL=$(read_env_var "$SCRIPT_DIR/../trino/.env" TRINO_MCP_USER)
TRINO_MCP_PASSWORD_VAL=$(read_env_var "$SCRIPT_DIR/../trino/.env" TRINO_MCP_PASSWORD)
[ -n "$TRINO_MCP_USER_VAL" ] || fail "TRINO_MCP_USER absent de apps/trino/.env : relancez le setup de Trino"
[ -n "$TRINO_MCP_PASSWORD_VAL" ] || fail "TRINO_MCP_PASSWORD absent de apps/trino/.env : relancez le setup de Trino"
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
set_env_value TRINO_USER "$TRINO_MCP_USER_VAL"
set_env_value TRINO_PASSWORD "$TRINO_MCP_PASSWORD_VAL"
# Clés structurelles du durcissement : toujours resynchronisées (un .env
# antérieur au durcissement porterait encore HTTP/8080).
set_env_value TRINO_PORT "8443"
set_env_value TRINO_SCHEME "https"
set_env_value TRINO_SSL "true"
set_env_value TRINO_SSL_INSECURE "true"
echo "    credentials Trino mcp-trino synchronisés (jamais affichés)"

if [ "$SKIP_START" = "1" ]; then
    echo ""
    echo "Préparation terminée (--skip-start : stack non démarrée)."
    echo "Démarrage manuel : sh run.sh start"
    exit 0
fi

echo "===> Démarrage de la stack mcp-trino..."
docker compose up -d --wait
echo "    mcp-trino est démarré et sain"

MCP_HTTP_PORT=$(get_env_value MCP_TRINO_HTTP_PORT)
MCP_HTTP_PORT=${MCP_HTTP_PORT:-8185}
MCP_BODY_FILE=$(mktemp)
MCP_HEADERS_FILE=$(mktemp)
trap 'rm -f "$MCP_BODY_FILE" "$MCP_HEADERS_FILE"' EXIT

echo "===> Test de bout en bout : handshake MCP + exécution SELECT 1..."
mcp_post '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"parusdb-setup","version":"0.1.0"}}}' \
    || fail "l'endpoint MCP ne répond pas (http://localhost:$MCP_HTTP_PORT/mcp)"

MCP_SESSION=$(awk 'tolower($1)=="mcp-session-id:" {gsub("\r","",$2); print $2}' "$MCP_HEADERS_FILE")
if [ -n "$MCP_SESSION" ]; then
    MCP_SESSION_HEADER="Mcp-Session-Id: $MCP_SESSION"
fi

mcp_post '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null

mcp_post '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
    || fail "tools/list a échoué"
echo "    Outils exposés :"
grep -o '"name":"[a-z_]*"' "$MCP_BODY_FILE" | cut -d'"' -f4 | sed 's/^/      - /'

mcp_post '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"execute_query","arguments":{"query":"SELECT 1 AS parusdb_mcp_ok"}}}' \
    || fail "execute_query a échoué"
grep -q "parusdb_mcp_ok" "$MCP_BODY_FILE" \
    || fail "execute_query n'a pas retourné le résultat attendu : $(cat "$MCP_BODY_FILE")"
echo "    execute_query : SELECT 1 → OK (requête relayée jusqu'à Trino)"

echo ""
echo "mcp-trino est prêt."
echo "  Endpoint MCP          : http://localhost:$MCP_HTTP_PORT/mcp"
echo "  Statut                : http://localhost:$MCP_HTTP_PORT/status"
echo "  Test e2e Chat IA      : cd ../ollama && sh run.sh test"
echo ""
