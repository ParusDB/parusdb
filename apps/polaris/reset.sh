#!/bin/sh
#
# Réinitialisation complète d'Apache Polaris :
#   1. arrêt et suppression des conteneurs ;
#   2. suppression de la base et du rôle PostgreSQL `polaris` dans le Postgres
#      de la stack Supabase (métadonnées du catalogue — irréversible) ;
#   3. suppression facultative du bucket RustFS (données Iceberg — irréversible) ;
#   4. suppression des clés RSA du token broker (volumes/token-keys) ;
#   5. remise à zéro de .env (sauvegarde en .env.old).
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
echo "*** ATTENTION : suppression des conteneurs Polaris, de la base PostgreSQL de ses métadonnées, et remise à zéro de .env ***"
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

POLARIS_DB_NAME=$(grep '^POLARIS_DB_NAME=' .env 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d "\r\"'")
POLARIS_DB_USER=$(grep '^POLARIS_DB_USER=' .env 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d "\r\"'")
POLARIS_DB_NAME=${POLARIS_DB_NAME:-polaris}
POLARIS_DB_USER=${POLARIS_DB_USER:-polaris}

echo "===> Suppression de la base '$POLARIS_DB_NAME' et du rôle '$POLARIS_DB_USER' (Postgres Supabase)..."
confirm
if docker ps --filter name=supabase-db --format '{{.Names}}' 2>/dev/null | grep -q .; then
    # L'image Supabase donne le rôle SUPERUSER à `supabase_admin` (pas `postgres`).
    docker exec supabase-db psql -U supabase_admin -v ON_ERROR_STOP=1 \
        -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POLARIS_DB_NAME}' AND pid <> pg_backend_pid();" \
        -c "DROP DATABASE IF EXISTS \"${POLARIS_DB_NAME}\";" \
        -c "DROP ROLE IF EXISTS \"${POLARIS_DB_USER}\";" >/dev/null
    echo "Base et rôle supprimés."
else
    echo "Le conteneur supabase-db n'est pas démarré : base et rôle non supprimés."
fi

echo "===> Suppression du bucket RustFS (données Iceberg) [optionnel]..."
if docker ps --filter name=supabase-rustfs --format '{{.Names}}' 2>/dev/null | grep -q .; then
    POLARIS_S3_BUCKET=$(grep '^POLARIS_S3_BUCKET=' .env 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d "\r\"'")
    S3_ENDPOINT_INTERNAL=$(grep '^S3_ENDPOINT_INTERNAL=' .env 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d "\r\"'")
    S3_ACCESS_KEY_ID=$(grep '^S3_ACCESS_KEY_ID=' .env 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d "\r\"'")
    S3_SECRET_ACCESS_KEY=$(grep '^S3_SECRET_ACCESS_KEY=' .env 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d "\r\"'")
    POLARIS_S3_BUCKET=${POLARIS_S3_BUCKET:-parus-lakehouse}
    S3_ENDPOINT_INTERNAL=${S3_ENDPOINT_INTERNAL:-http://rustfs:9000}
    if [ "$auto_confirm" = "0" ]; then
        printf "Supprimer aussi le bucket '%s' et toutes les données Iceberg qu'il contient ? (y/N) " "$POLARIS_S3_BUCKET"
        read -r REPLY
        case "$REPLY" in
            [Yy])
                docker run --rm -i --network supabase_default --entrypoint /bin/sh rustfs/rc -s <<RC
set -e
rc alias set parus-rustfs "$S3_ENDPOINT_INTERNAL" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
rc rb --force "parus-rustfs/$POLARIS_S3_BUCKET"
RC
                echo "Bucket supprimé."
                ;;
            *)
                echo "Bucket conservé."
                ;;
        esac
    else
        echo "-y fourni : bucket conservé (supprimez-le manuellement si besoin)."
    fi
else
    echo "Le service RustFS n'est pas démarré : bucket conservé."
fi

echo "===> Suppression des clés RSA du token broker (volumes/token-keys)..."
if [ -d "./volumes/token-keys" ]; then
    confirm
    rm -rf ./volumes/token-keys
    echo "Clés supprimées (elles seront régénérées par setup.sh)."
else
    echo "volumes/token-keys introuvable."
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
