#!/bin/sh
#
# Gérer la stack Apache Polaris de ParusDB (docker compose).
#
# Contrairement à apps/supabase, il n'y a pas d'override COMPOSE_FILE : la
# stack Polaris tient dans un unique docker-compose.yml. Le script suppose
# que la stack Supabase est démarrée (réseau externe supabase_default,
# Postgres du service `db`, RustFS du service `rustfs`).
#
# Usage :
#   sh run.sh start                  # docker compose up -d --wait
#   sh run.sh stop                   # docker compose down
#   sh run.sh restart [service]      # redémarrer la stack (ou des services nommés)
#   sh run.sh recreate [service]     # stop puis start (ou force-recreate --no-deps)
#   sh run.sh status                 # docker compose ps
#   sh run.sh logs [service]         # suivre les logs (tous ou un service)
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

# Vérifie que la stack Supabase est joignable avant de démarrer Polaris
# (réseau externe + Postgres + RustFS requis).
check_supabase() {
    docker network inspect supabase_default >/dev/null 2>&1 \
        || { echo "ERREUR : réseau Docker supabase_default introuvable." >&2
             echo "Démarrez d'abord la stack Supabase (cd ../supabase && sh run.sh start)." >&2
             exit 1; }
}

# Liste des services moins ceux passés en arguments.
services_except() {
    all_services=$(docker compose config --services)
    filtered="$all_services"
    for ex in "$@"; do
        echo "$all_services" | grep -qFx "$ex" \
            || echo "Attention : '$ex' n'est pas un service de ce projet" >&2
        filtered=$(echo "$filtered" | grep -vFx "$ex" || true)
    done
    if [ -z "$filtered" ]; then
        echo "Aucun service restant après --except" >&2
        return 1
    fi
    printf '%s\n' "$filtered"
}

CMD="${1:-help}"
[ "$#" -gt 0 ] && shift

case "$CMD" in
    start|up)
        check_supabase
        exec docker compose up -d --wait "$@"
        ;;
    stop|down)
        exec docker compose down "$@"
        ;;
    restart)
        if [ "${1:-}" = "--except" ]; then
            shift
            [ $# -eq 0 ] && { echo "Usage : $(basename "$0") restart --except <svc>..." >&2; exit 1; }
            services=$(services_except "$@") || exit 1
            # shellcheck disable=SC2086
            exec docker compose restart $services
        fi
        exec docker compose restart "$@"
        ;;
    recreate)
        if [ "${1:-}" = "--except" ]; then
            shift
            [ $# -eq 0 ] && { echo "Usage : $(basename "$0") recreate --except <svc>..." >&2; exit 1; }
            services=$(services_except "$@") || exit 1
            # shellcheck disable=SC2086
            exec docker compose up -d --wait --force-recreate --no-deps $services
        fi
        if [ $# -eq 0 ]; then
            docker compose down
            check_supabase
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
        for var in POLARIS_DB_PASSWORD POLARIS_ROOT_CLIENT_SECRET \
                   S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
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
  restart [service]     Redémarrer la stack (ou des services nommés)
  restart --except <svc>...
                        Redémarrer tous les services sauf ceux listés
  recreate [service]    Stop puis start, ou force-recreate d'un service (--no-deps)
  recreate --except <svc>...
                        Force-recreate tous les services sauf ceux listés (--no-deps)
  status                Afficher le statut des services
  logs [service]        Suivre les logs (tous, ou un service)
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
