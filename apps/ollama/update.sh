#!/bin/sh
#
# Mettre à jour la stack Ollama en place.
#
# Ce que fait ce script :
#   1. ajoute à .env les clés apparues dans .env.example (les valeurs
#      existantes ne sont jamais modifiées) ;
#   2. tire l'image docker compose épinglée dans docker-compose.yml ;
#   3. recrée le conteneur si l'image a changé (docker compose up -d --wait) ;
#   4. met à jour les modèles listés dans OLLAMA_MODELS (ollama pull
#      rafraîchit un modèle vers sa dernière version publiée).
#
# Pour changer de version d'Ollama : éditer le tag d'image dans
# docker-compose.yml puis relancer ce script.
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

echo "===> Mise à jour des modèles (OLLAMA_MODELS)..."
for model in $(grep '^OLLAMA_MODELS=' .env | head -n 1 | cut -d= -f2-); do
    [ -n "$model" ] || continue
    echo "    ollama pull $model"
    docker compose exec -T ollama ollama pull "$model"
done

echo ""
echo "Mise à jour terminée."
echo ""
