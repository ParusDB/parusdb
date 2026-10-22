#!/bin/sh
#
# Réinitialiser le moteur ELT dlt de ParusDB (destructif).
#
# Supprime : l'ordonnanceur, le volume d'état des pipelines (cursors
# incrémentaux dlt — les exécutions incrémentales repartiront de zéro), le
# rôle PostgreSQL parus_dlt et le .env local. Les données déjà chargées dans
# le lakehouse ne sont PAS touchées (elles vivent dans Polaris/RustFS).
#
# Usage :
#   sh reset.sh          # réinitialiser (conteneurs, volume, rôle, .env)
#   sh reset.sh --keep-env  # réinitialiser sans supprimer le .env
#

set -e

cd "$(dirname "$0")"

KEEP_ENV=0
[ "${1:-}" = "--keep-env" ] && KEEP_ENV=1

echo "===> Arrêt de l'ordonnanceur et suppression du volume d'état..."
if [ -f .env ]; then
    docker compose down -v 2>/dev/null || true
else
    docker compose down -v 2>/dev/null || true
fi
docker volume rm parus-dlt-state 2>/dev/null || true
echo "    conteneurs et volume parus-dlt-state supprimés"

echo "===> Suppression des conteneurs de run résiduels..."
docker ps -aq --filter label=parusdb.kind=dlt-runner 2>/dev/null \
    | xargs -r docker rm -f 2>/dev/null || true
echo "    conteneurs de run supprimés"

echo "===> Suppression du rôle PostgreSQL parus_dlt..."
if docker ps --filter name=supabase-db --format '{{.Names}}' 2>/dev/null | grep -q .; then
    docker exec supabase-db psql -U supabase_admin -d postgres \
        -c "drop role if exists parus_dlt" >/dev/null 2>&1 || true
    echo "    rôle supprimé"
else
    echo "    supabase-db arrêté : rôle non supprimé (à faire manuellement)"
fi

if [ "$KEEP_ENV" = "1" ]; then
    echo "===> .env conservé (--keep-env)"
else
    rm -f .env
    echo "===> .env supprimé (relancez sh setup.sh pour repartir de zéro)"
fi

echo ""
echo "Réinitialisation terminée."
echo "NB : les données déjà chargées dans le lakehouse (Polaris/RustFS) et les"
echo "pipelines enregistrés (Postgres applicatif) ne sont pas supprimés."
