#!/bin/sh
#
# Mettre à jour le moteur ELT dlt de ParusDB.
#
# Reconstruit l'image du runner (dlt + sources verified au commit épinglé du
# Dockerfile) puis recrée l'ordonnanceur. L'état des pipelines (volume
# parus-dlt-state) est conservé.
#
# Usage :
#   sh update.sh          # rebuild + recréation de l'ordonnanceur
#

set -e

cd "$(dirname "$0")"

if [ ! -f .env ]; then
    echo "ERREUR : .env introuvable — lancez d'abord 'sh setup.sh'" >&2
    exit 1
fi

echo "===> Reconstruction de l'image du runner..."
docker compose build

echo "===> Recréation de l'ordonnanceur..."
docker compose up -d --wait

echo ""
echo "Mise à jour terminée. Les runs en cours ont été interrompus :"
echo "relancez-les depuis l'interface (bouton Lancer) si nécessaire."
