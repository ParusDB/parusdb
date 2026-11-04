#!/bin/sh
#
# Réinitialisation complète de mcp-trino :
#   1. arrêt et suppression des conteneurs ;
#   2. remise à zéro de .env (sauvegarde en .env.old).
#
# mcp-trino est sans état : aucune donnée n'est détruite (les données vivent
# dans le lakehouse Polaris/RustFS, les métadonnées dans la base `polaris` du
# Postgres Supabase).
#
# Usage : sh reset.sh [-y]
#

set -e

cd "$(dirname "$0")"

auto_confirm=0

confirm() {
    if [ "$auto_confirm" = "1" ]; then
        return 0
    fi
    printf "Confirmer ? (y/N) "
    read -r REPLY
    case "$REPLY" in
        [Yy]) ;;
        *) echo "Script annulé."; exit 1 ;;
    esac
}

if [ "$1" = "-y" ]; then
    auto_confirm=1
fi

echo ""
echo "*** ATTENTION : suppression des conteneurs mcp-trino et remise à zéro de .env ***"
echo "*** Le serveur est sans état : aucune donnée du lakehouse n'est touchée.       ***"
echo ""
confirm

echo "===> Arrêt et suppression des conteneurs..."

# Un `docker compose down` n'utilise aucune valeur d'environnement réelle :
# seules les interpolations `${VAR:?…}` du compose doivent aboutir. Un `.env`
# illisible (créé en root par un sudo, incident réel) ou réduit aux valeurs
# d'exemple (reset interrompu avant setup) ne doit donc pas bloquer l'arrêt :
# on fournit une valeur factice à chaque variable référencée par le compose
# et on force un fichier d'environnement lisible.
compose_down() {
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
        down -v --remove-orphans
}

compose_down

echo "===> Remise à zéro de .env (sauvegarde en .env.old)..."
confirm
if [ -f ".env" ] || [ -L ".env" ]; then
    echo "Renommage de .env en .env.old"
    mv .env .env.old
else
    echo "Aucun fichier .env trouvé."
fi

if [ -f ".env.example" ]; then
    echo "Copie de .env.example vers .env"
    cp .env.example .env
else
    echo "Aucun .env.example trouvé : impossible de restaurer les valeurs par défaut."
fi

echo ""
echo "Réinitialisation terminée."
echo "Relancez 'sh setup.sh' pour repartir de zéro."
echo ""
