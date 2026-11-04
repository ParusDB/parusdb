#!/bin/sh

set -e

auto_confirm=0

confirm () {
    if [ "$auto_confirm" = "1" ]; then
        return 0
    fi

    printf "Are you sure you want to proceed? (y/N) "
    read -r REPLY
    case "$REPLY" in
        [Yy])
            ;;
        *)
            echo "Script canceled."
            exit 1
            ;;
    esac
}

if [ "$1" = "-y" ]; then
    auto_confirm=1
fi

echo ""
echo "*** WARNING: This will remove all containers and container data, and optionally reset .env ***"
echo ""

confirm

echo "===> Stopping and removing all containers..."

# A `docker compose down` needs no real environment values: only the
# `${VAR:?...}` interpolations have to resolve. An unreadable `.env` (created
# by root through a sudo run) must not block the teardown, so dummy values
# are provided for every variable referenced by the compose files and a
# readable env file is forced.
if [ -r ".env" ]; then
    env_file=".env"
elif [ -r ".env.example" ]; then
    env_file=".env.example"
else
    env_file="/dev/null"
fi
compose_vars=""
for var in $(grep -ohE '\$\{[A-Za-z_][A-Za-z0-9_]*' docker-compose.yml ./dev/docker-compose.dev.yml \
    | sed 's/^\${//' | sort -u); do
    compose_vars="$compose_vars $var=1"
done
# shellcheck disable=SC2086
env $compose_vars docker compose --env-file "$env_file" \
    -f docker-compose.yml -f ./dev/docker-compose.dev.yml down -v --remove-orphans

echo "===> Cleaning up bind-mounted directories..."
# Fichiers écrits par les conteneurs (propriétaire root) : suppression via un
# conteneur éphémère busybox (Docker tourne en root), sans sudo. Repli sur
# rm -rf si Docker échoue (fichiers appartenant à l'utilisateur).
remove_bind_mount() {
    dir="$1"
    if [ -d "$dir" ]; then
        echo "Removing $dir..."
        confirm
        parent=$(cd "$(dirname "$dir")" && pwd)
        base=$(basename "$dir")
        if ! docker run --rm -v "$parent:/v" busybox rm -rf "/v/$base" 2>/dev/null; then
            rm -rf "$dir"
        fi
    else
        echo "$dir not found."
    fi
}

BIND_MOUNTS="./volumes/db/data ./volumes/storage"

for dir in $BIND_MOUNTS; do
    remove_bind_mount "$dir"
done

echo "===> Resetting .env file (will save backup to .env.old)..."
confirm
if [ -f ".env" ] || [ -L ".env" ]; then
    echo "Renaming existing .env file to .env.old"
    mv .env .env.old
else
    echo "No .env file found."
fi

if [ -f ".env.example" ]; then
    echo "===> Copying .env.example to .env"
    cp .env.example .env
else
    echo "No .env.example found, can't restore .env to default values."
fi

echo "Cleanup complete!"
echo "Re-run 'docker compose pull' to update images."
echo ""
