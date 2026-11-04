#!/bin/sh
#
# Réinitialisation complète d'Ollama :
#   1. arrêt et suppression des conteneurs ;
#   2. suppression des modèles téléchargés (volumes/ollama, plusieurs Go) ;
#   3. remise à zéro de .env (sauvegarde en .env.old).
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
echo "*** ATTENTION : suppression des conteneurs Ollama et de TOUS les modèles ***"
echo "*** téléchargés (volumes/ollama). Ils devront être re-téléchargés par    ***"
echo "*** 'sh setup.sh'. Aucune autre donnée n'est touchée.                    ***"
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
        down --remove-orphans
}

compose_down

echo "===> Suppression des modèles (volumes/ollama)..."
confirm
if [ -d "volumes/ollama" ]; then
    # Fichiers écrits par le conteneur (propriétaire root) : suppression via
    # un conteneur éphémère busybox, sans sudo. Repli sur rm -rf si Docker
    # échoue (fichiers appartenant à l'utilisateur).
    if ! docker run --rm -v "$(pwd)/volumes:/v" busybox rm -rf /v/ollama 2>/dev/null; then
        rm -rf volumes/ollama
    fi
    echo "    volumes/ollama supprimé"
else
    echo "    aucun dossier volumes/ollama trouvé"
fi

echo "===> Remise à zéro de .env (sauvegarde en .env.old)..."
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
