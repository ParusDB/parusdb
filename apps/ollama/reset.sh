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

if [ -f ".env" ]; then
    docker compose down --remove-orphans
elif [ -f ".env.example" ]; then
    echo "Pas de .env, utilisation de .env.example pour docker compose down..."
    docker compose --env-file .env.example -f docker-compose.yml down --remove-orphans
else
    echo "Arrêt ignoré : aucun fichier d'environnement."
fi

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
