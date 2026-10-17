#!/bin/sh
#
# Gérer la stack Trino de ParusDB (docker compose).
#
# Trino dépend de la stack Polaris (apps/polaris) sur le réseau externe
# `supabase_default`. Les projets compose étant distincts, `start` vérifie
# que Polaris répond avant de lancer Trino.
#
# Usage :
#   sh run.sh start                  # docker compose up -d --wait
#   sh run.sh stop                   # docker compose down
#   sh run.sh restart                # redémarrer la stack
#   sh run.sh recreate               # stop puis start
#   sh run.sh status                 # docker compose ps
#   sh run.sh logs [service]         # suivre les logs
#   sh run.sh cli                    # ouvrir une session SQL Trino
#   sh run.sh inspect <service>      # docker inspect sur le conteneur d'un service
#   sh run.sh printenv <service>     # afficher les variables d'environnement d'un service
#   sh run.sh pull                   # tirer les images
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

# Vérifie que Polaris est joignable avant de démarrer Trino
# (le catalogue iceberg ne s'initialise pas sans Polaris).
check_polaris() {
    POLARIS_MANAGEMENT_PORT=$(grep '^POLARIS_MANAGEMENT_PORT=' ../polaris/.env 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d "\r\"'")
    POLARIS_MANAGEMENT_PORT=${POLARIS_MANAGEMENT_PORT:-8182}
    curl -s --max-time 10 -o /dev/null -f "http://localhost:$POLARIS_MANAGEMENT_PORT/q/health" \
        || { echo "ERREUR : l'API de Polaris ne répond pas." >&2
             echo "Démarrez d'abord Polaris (cd ../polaris && sh run.sh start)." >&2
             exit 1; }
}

CMD="${1:-help}"
[ "$#" -gt 0 ] && shift

case "$CMD" in
    start|up)
        check_polaris
        exec docker compose up -d --wait "$@"
        ;;
    stop|down)
        exec docker compose down "$@"
        ;;
    restart)
        exec docker compose restart "$@"
        ;;
    recreate)
        if [ $# -eq 0 ]; then
            docker compose down
            check_polaris
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
    cli)
        echo "Session SQL Trino — catalogue 'polaris' (warehouse Polaris). Ctrl-D pour sortir."
        exec docker compose exec trino trino
        ;;
    inspect)
        [ $# -eq 0 ] && { echo "Usage : $(basename "$0") inspect <service> [docker-inspect-args]" >&2; exit 1; }
        svc="$1"; shift
        cid=$(docker compose ps -q "$svc")
        [ -z "$cid" ] && { echo "Le service '$svc' n'est pas en cours d'exécution" >&2; exit 1; }
        exec docker inspect "$cid" "$@"
        ;;
    printenv)
        [ $# -eq 0 ] && { echo "Usage : $(basename "$0") printenv <service>" >&2; exit 1; }
        svc="$1"
        cid=$(docker compose ps -q "$svc")
        [ -z "$cid" ] && { echo "Le service '$svc' n'est pas en cours d'exécution" >&2; exit 1; }
        exec docker inspect --format='{{range .Config.Env}}{{println .}}{{end}}' "$cid"
        ;;
    pull)
        exec docker compose pull "$@"
        ;;
    compose-config)
        exec docker compose config "$@"
        ;;
    secrets)
        for var in POLARIS_CLIENT_ID POLARIS_CLIENT_SECRET; do
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
  start                 Démarrer la stack (docker compose up -d --wait)
  stop                  Arrêter la stack (docker compose down)
  restart               Redémarrer la stack
  recreate              Stop puis start, ou force-recreate (--no-deps)
  status                Afficher le statut des services
  logs [service]        Suivre les logs (tous, ou un service)
  cli                   Ouvrir une session SQL Trino interactive
  inspect <service>     Inspecter le conteneur d'un service (args transmis à docker inspect)
  printenv <service>    Afficher les variables d'environnement d'un service
  pull                  Tirer les images
  compose-config        Afficher la configuration compose entièrement résolue
  secrets               Afficher les secrets clés du .env

EOF
        ;;
    *)
        echo "Commande inconnue : $CMD" >&2
        echo "Lancez '$0 help' pour l'usage." >&2
        exit 1
        ;;
esac
