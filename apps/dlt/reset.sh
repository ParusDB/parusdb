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
# Un `docker compose down` n'utilise aucune valeur d'environnement réelle :
# seules les interpolations `${VAR:?…}` du compose doivent aboutir. Un `.env`
# illisible (créé en root par un sudo, incident réel) ne doit donc pas
# bloquer l'arrêt : on fournit une valeur factice à chaque variable
# référencée par le compose et on force un fichier d'environnement lisible.
if [ -r ".env" ]; then
    env_file=".env"
elif [ -r ".env.example" ]; then
    env_file=".env.example"
else
    env_file="/dev/null"
fi
compose_vars=""
for var in $(grep -ohE '\$\{[A-Za-z_][A-Za-z0-9_]*' docker-compose.yml \
    | sed 's/^\${//' | sort -u); do
    compose_vars="$compose_vars $var=1"
done
# shellcheck disable=SC2086
env $compose_vars docker compose --env-file "$env_file" -f docker-compose.yml \
    down -v 2>/dev/null || true
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
