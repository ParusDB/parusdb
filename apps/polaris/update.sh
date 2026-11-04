#!/bin/sh
#
# Mettre à jour la stack Apache Polaris en place.
#
# Ce que fait ce script :
#   1. ajoute à .env les clés apparues dans .env.example (les valeurs
#      existantes ne sont jamais modifiées) ;
#   2. tire les images des versions épinglées dans docker-compose.yml ;
#   3. recrée les conteneurs dont l'image a changé (docker compose up -d --wait).
#
# Pour changer de version d'Apache Polaris ou de Trino : éditer les tags
# d'image dans docker-compose.yml puis relancer ce script, puis relire les
# release notes (https://polaris.apache.org/). `sh setup.sh` reste relançable
# (idempotent) si un changement de version l'exige.
#
# Ce que ce script ne touche jamais : vos valeurs dans .env, la base
# PostgreSQL `polaris` et le bucket RustFS (données du lakehouse).
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

echo "===> Récupération des images..."
docker compose pull

echo "===> Recréation des conteneurs..."
docker compose up -d --wait

echo ""
echo "Mise à jour terminée."
echo "Après un changement de version majeure d'Apache Polaris : relisez les release"
echo "notes (https://polaris.apache.org/) puis relancez 'sh setup.sh' (idempotent)."
echo ""
