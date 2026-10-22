#!/bin/sh
#
# Gérer le moteur ELT dlt de ParusDB (docker compose).
#
# Usage :
#   sh run.sh start                  # démarrer l'ordonnanceur
#   sh run.sh stop                   # arrêter l'ordonnanceur
#   sh run.sh restart                # redémarrer l'ordonnanceur
#   sh run.sh status                 # statut des services + runs en cours
#   sh run.sh logs                   # suivre les logs de l'ordonnanceur
#   sh run.sh runs                   # lister les conteneurs de run jetables
#   sh run.sh build                  # (re)construire l'image du runner
#   sh run.sh catalog                # afficher le catalogue des sources (JSON)
#   sh run.sh test-run <run_id>      # rejouer un run manuellement (debug)
#   sh run.sh verify                 # vérifier runner + Polaris + Postgres
#   sh run.sh pull                   # tirer les images
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

env_value() {
    grep "^$1=" .env | head -n 1 | cut -d= -f2- | tr -d "\r\"" | sed -e 's/^"//' -e 's/"$//'
}

IMAGE=$(env_value PARUSDB_DLT_IMAGE)
NETWORK=$(env_value PARUSDB_DLT_NETWORK)
STATE_VOLUME=$(env_value PARUSDB_DLT_STATE_VOLUME)

CMD="${1:-help}"
[ "$#" -gt 0 ] && shift

case "$CMD" in
    start|up)
        exec docker compose up -d --wait "$@"
        ;;
    stop|down)
        exec docker compose down "$@"
        ;;
    restart)
        exec docker compose restart "$@"
        ;;
    status|ps)
        docker compose ps "$@"
        echo ""
        echo "Conteneurs de run jetables :"
        docker ps -a --filter label=parusdb.kind=dlt-runner \
            --format 'table {{.Names}}\t{{.Status}}' 2>/dev/null || true
        ;;
    logs)
        exec docker compose logs -f "$@"
        ;;
    runs)
        exec docker ps -a --filter label=parusdb.kind=dlt-runner \
            --format 'table {{.Names}}\t{{.Status}}\t{{.RunningFor}}'
        ;;
    build)
        exec docker compose build "$@"
        ;;
    catalog)
        # Pas d'environnement requis : le catalogue ne touche ni la base ni
        # Polaris (utile pour vérifier que les sources s'importent).
        exec docker run --rm --network "$NETWORK" \
            "$IMAGE" python -m runner.main catalog
        ;;
    test-run)
        [ -z "$1" ] && { echo "Usage : sh run.sh test-run <run_id>" >&2; exit 1; }
        echo "Rejeu manuel du run $1 (conteneur jetable, env du .env local)."
        exec docker run --rm --network "$NETWORK" --env-file ./.env \
            -e PARUSDB_RUN_ID="$1" \
            -v "$STATE_VOLUME:/var/lib/dlt" \
            "$IMAGE"
        ;;
    verify)
        echo "===> Catalogue des sources..."
        docker run --rm --network "$NETWORK" \
            "$IMAGE" python -m runner.main catalog >/dev/null \
            && echo "    runner : sources importées" \
            || exit 1
        echo "===> Postgres applicatif (rôle $(env_value PARUSDB_DB_USER))..."
        docker run --rm --network "$NETWORK" --env-file ./.env "$IMAGE" python - <<'PY' \
            && echo "    Postgres : connexion OK" \
            || exit 1
import os, sys
from runner import db
conn = db.connect()
cur = conn.cursor()
cur.execute("select count(*) from connectors.pipelines")
print("    pipelines visibles :", cur.fetchone()[0])
PY
        echo "===> Polaris (catalogue Iceberg REST)..."
        docker run --rm --network "$NETWORK" --env-file ./.env "$IMAGE" python - <<'PY' \
            && echo "    Polaris : catalogue joignable" \
            || exit 1
import os
from pyiceberg.catalog import load_catalog
from runner.destination import iceberg_props
catalog = load_catalog("parus", **iceberg_props(os.environ.get("PARUSDB_TEST_WAREHOUSE", "dev")))
print("    namespaces :", [ns for ns in catalog.list_namespaces()][:5])
PY
        echo ""
        echo "Vérifications terminées."
        ;;
    pull)
        exec docker compose pull "$@"
        ;;
    secrets)
        echo "PARUSDB_DB_USER=$DB_ROLE"
        echo "PARUSDB_ENCRYPTION_KEY définie : $([ -n "$(env_value PARUSDB_ENCRYPTION_KEY)" ] && echo oui || echo non)"
        echo "PARUSDB_POLARIS_CLIENT_ID=$(env_value PARUSDB_POLARIS_CLIENT_ID)"
        echo "PARUSDB_POLARIS_CLIENT_SECRET définie : $([ -n "$(env_value PARUSDB_POLARIS_CLIENT_SECRET)" ] && echo oui || echo non)"
        echo ""
        ;;
    help|-h|--help)
        cat <<EOF
Usage : sh run.sh <commande>

Commandes :
  start                 Démarrer l'ordonnanceur (docker compose up -d --wait)
  stop                  Arrêter l'ordonnanceur
  restart               Redémarrer l'ordonnanceur
  status                Statut compose + conteneurs de run jetables
  logs                  Suivre les logs de l'ordonnanceur
  runs                  Lister les conteneurs de run jetables
  build                 (Re)construire l'image du runner
  catalog               Catalogue des sources (JSON)
  test-run <run_id>     Rejouer un run manuellement (debug)
  verify                Vérifier runner + Postgres + Polaris
  pull                  Tirer les images
  secrets               Afficher l'état des secrets du .env

EOF
        ;;
    *)
        echo "Commande inconnue : $CMD" >&2
        echo "Lancez 'sh run.sh help' pour l'usage." >&2
        exit 1
        ;;
esac
