#!/bin/sh
#
# Gérer la stack mcp-trino de ParusDB (docker compose).
#
# mcp-trino est l'unique chemin LLM ↔ données (AGENTS.md §11) : il expose les
# outils MCP (list_catalogs, list_schemas, list_tables, get_table_schema,
# execute_query, explain_query) sur l'endpoint HTTP /mcp et exécute les
# requêtes sur Trino (apps/trino). Les projets compose étant distincts,
# `start` vérifie que Trino répond avant de lancer mcp-trino.
#
# Usage :
#   sh run.sh start                  # docker compose up -d --wait
#   sh run.sh stop                   # docker compose down
#   sh run.sh restart                # redémarrer la stack
#   sh run.sh recreate               # stop puis start
#   sh run.sh status                 # docker compose ps
#   sh run.sh logs                   # suivre les logs
#   sh run.sh test                   # handshake MCP + SELECT 1 via execute_query
#   sh run.sh inspect                # docker inspect du conteneur
#   sh run.sh printenv               # variables d'environnement du conteneur
#   sh run.sh pull                   # tirer l'image
#   sh run.sh compose-config         # afficher la configuration compose résolue
#   sh run.sh secrets                # afficher les secrets clés du .env
#

set -e

cd "$(dirname "$0")"

if [ ! -f docker-compose.yml ]; then
    echo "ERREUR : docker-compose.yml introuvable dans $(pwd)" >&2
    exit 1
fi

if [ ! -f .env ]; then
    echo "ERREUR : .env introuvable — lancez d'abord 'sh setup.sh'" >&2
    exit 1
fi

# Vérifie que Trino est joignable avant de démarrer mcp-trino
# (le serveur s'arrête de lui-même si Trino est indisponible).
check_trino() {
    TRINO_PORT_HOST=$(grep '^TRINO_PORT=' ../trino/.env 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d "\r\"'")
    TRINO_PORT_HOST=${TRINO_PORT_HOST:-8080}
    curl -s --max-time 10 -o /dev/null -f "http://localhost:$TRINO_PORT_HOST/v1/info" \
        || { echo "ERREUR : l'API de Trino ne répond pas." >&2
             echo "Démarrez d'abord Trino (cd ../trino && sh run.sh start)." >&2
             exit 1; }
}

read_env_var() {
    grep "^$2=" "$1" | head -n 1 | cut -d= -f2- | tr -d "\r" | sed -e "s/^\"//" -e "s/\"$//"
}

get_env_value() {
    read_env_var .env "$1"
}

# Requête JSON-RPC vers l'endpoint MCP Streamable HTTP.
mcp_post() {
    curl -s --max-time 15 -o "$MCP_BODY_FILE" -D "$MCP_HEADERS_FILE" \
        -X POST "http://localhost:$MCP_HTTP_PORT/mcp" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        ${MCP_SESSION_HEADER:+"-H" "$MCP_SESSION_HEADER"} \
        -d "$1"
}

mcp_smoke_test() {
    MCP_HTTP_PORT=$(get_env_value MCP_TRINO_HTTP_PORT)
    MCP_HTTP_PORT=${MCP_HTTP_PORT:-8185}
    MCP_BODY_FILE=$(mktemp)
    MCP_HEADERS_FILE=$(mktemp)
    trap 'rm -f "$MCP_BODY_FILE" "$MCP_HEADERS_FILE"' EXIT

    mcp_post '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"parusdb-run","version":"0.1.0"}}}' \
        || { echo "ERREUR : l'endpoint MCP ne répond pas (http://localhost:$MCP_HTTP_PORT/mcp)" >&2; exit 1; }
    MCP_SESSION=$(awk 'tolower($1)=="mcp-session-id:" {gsub("\r","",$2); print $2}' "$MCP_HEADERS_FILE")
    [ -n "$MCP_SESSION" ] && MCP_SESSION_HEADER="Mcp-Session-Id: $MCP_SESSION"
    mcp_post '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null

    mcp_post '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
        || { echo "ERREUR : tools/list a échoué" >&2; exit 1; }
    echo "Outils exposés :"
    grep -o '"name":"[a-z_]*"' "$MCP_BODY_FILE" | cut -d'"' -f4 | sed 's/^/  - /'

    mcp_post '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"execute_query","arguments":{"query":"SELECT 1 AS parusdb_mcp_ok"}}}' \
        || { echo "ERREUR : execute_query a échoué" >&2; exit 1; }
    grep -q "parusdb_mcp_ok" "$MCP_BODY_FILE" \
        || { echo "ERREUR : execute_query n'a pas retourné le résultat attendu" >&2; exit 1; }
    echo "execute_query : SELECT 1 → OK (requête relayée jusqu'à Trino)"
}

CMD="${1:-help}"
[ "$#" -gt 0 ] && shift

case "$CMD" in
    start|up)
        check_trino
        exec docker compose up -d --wait "$@"
        ;;
    stop|down)
        exec docker compose down "$@"
        ;;
    restart)
        exec docker compose restart "$@"
        ;;
    recreate)
        if [ "$#" -eq 0 ]; then
            # Garde-fou AVANT le down : ne pas démonter mcp-trino si Trino
            # est indisponible (sinon on détruit puis on refuse de remonter).
            check_trino
            docker compose down
            exec docker compose up -d --wait
        fi
        exec docker compose up -d --wait --force-recreate --no-deps "$@"
        ;;
    status|ps)
        exec docker compose ps "$@"
        ;;
    logs)
        exec docker compose logs -f "$@"
        ;;
    test)
        check_trino
        mcp_smoke_test
        ;;
    inspect)
        cid=$(docker compose ps -q mcp-trino)
        [ -z "$cid" ] && { echo "Le service 'mcp-trino' n'est pas en cours d'exécution" >&2; exit 1; }
        exec docker inspect "$cid" "$@"
        ;;
    printenv)
        cid=$(docker compose ps -q mcp-trino)
        [ -z "$cid" ] && { echo "Le service 'mcp-trino' n'est pas en cours d'exécution" >&2; exit 1; }
        exec docker inspect --format='{{range .Config.Env}}{{println .}}{{end}}' "$cid"
        ;;
    pull)
        exec docker compose pull "$@"
        ;;
    compose-config)
        exec docker compose config "$@"
        ;;
    secrets)
        for var in TRINO_PASSWORD; do
            line=$(grep "^${var}=" .env | head -n 1)
            if [ -n "$line" ]; then
                echo "$line"
            else
                echo "${var}="
            fi
        done
        echo ""
        ;;
    help|-h|--help)
        cat <<EOF
Usage : $(basename "$0") <commande>

Commandes :
  start            Démarrer la stack (docker compose up -d --wait)
  stop             Arrêter la stack (docker compose down)
  restart          Redémarrer la stack
  recreate         Stop puis start, ou force-recreate (--no-deps)
  status           Afficher le statut des services
  logs             Suivre les logs
  test             Handshake MCP + SELECT 1 via execute_query
  inspect           Inspecter le conteneur (args transmis à docker inspect)
  printenv         Afficher les variables d'environnement du conteneur
  pull              Tirer l'image
  compose-config   Afficher la configuration compose entièrement résolue
  secrets          Afficher les secrets clés du .env

EOF
        ;;
    *)
        echo "Commande inconnue : $CMD" >&2
        echo "Lancez '$0 help' pour l'usage." >&2
        exit 1
        ;;
esac
