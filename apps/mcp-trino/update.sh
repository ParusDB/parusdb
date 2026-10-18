#!/bin/sh
#
# Mettre à jour la stack mcp-trino en place.
#
# Ce que fait ce script :
#   1. ajoute à .env les clés apparues dans .env.example (les valeurs
#      existantes ne sont jamais modifiées) ;
#   2. tire l'image épinglée dans docker-compose.yml ;
#   3. recrée le conteneur si l'image a changé (docker compose up -d --wait).
#
# Pour changer de version de mcp-trino : éditer le tag d'image dans
# docker-compose.yml puis relancer ce script. Relire les release notes
# (https://github.com/tuannvm/mcp-trino/releases) en cas de saut de version
# majeure (les variables d'environnement peuvent changer).
#
# Usage : sh update.sh
#

set -e

cd "$(dirname "$0")"

if [ ! -f .env ]; then
    echo "ERREUR : .env introuvable — lancez d'abord 'sh setup.sh'" >&2
    exit 1
fi

echo "===> Ajout des clés manquantes de .env.example..."
while IFS= read -r line; do
    case "$line" in
        '#'*|'') continue ;;
        *=*)
            var=$(printf '%s\n' "$line" | cut -d= -f1)
            if ! grep -q "^${var}=" .env; then
                printf '%s\n' "$line" >> .env
                echo "    clé ajoutée : $var"
            fi
            ;;
    esac
done < .env.example

echo "===> Récupération de l'image..."
docker compose pull

echo "===> Recréation du conteneur..."
docker compose up -d --wait

echo ""
echo "Mise à jour terminée."
echo ""
