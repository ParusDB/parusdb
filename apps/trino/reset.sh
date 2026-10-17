#!/bin/sh
#
# Réinitialisation complète de Trino :
#   1. arrêt et suppression des conteneurs ;
#   2. remise à zéro de .env (sauvegarde en .env.old).
#
# Trino est sans état : aucune donnée n'est détruite (les données Iceberg
# vivent dans Polaris + RustFS ; les métadonnées dans la base `polaris` du
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
echo "*** ATTENTION : suppression des conteneurs Trino et remise à zéro de .env ***"
echo "*** Les données du lakehouse (Polaris, RustFS) ne sont pas touchées.        ***"
echo ""
confirm

echo "===> Arrêt et suppression des conteneurs..."

if [ -f ".env" ]; then
    docker compose down -v --remove-orphans
elif [ -f ".env.example" ]; then
    echo "Pas de .env, utilisation de .env.example pour docker compose down..."
    docker compose --env-file .env.example -f docker-compose.yml down -v --remove-orphans
else
    echo "Arrêt ignoré : aucun fichier d'environnement."
fi

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
