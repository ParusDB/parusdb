#!/bin/sh
#
# Désinstallation complète de la stack ParusDB : reset app par app, dans
# l'ordre inverse des dépendances (les dépendances meurent en dernier).
#
# Détruit pour chaque app : conteneurs, volumes, données (base PostgreSQL,
# données lakehouse, modèles LLM) et .env (sauvegardés en .env.old).
# Les images Docker sont conservées pour accélérer la réinstallation —
# sauf avec --purge-images.
#
# Usage :
#   sh reset.sh                 # désinstallation interactive (confirmation)
#   sh reset.sh --purge-images  # idem + suppression des images Docker
#   sh reset.sh -h | --help     # aide
#
# Réinstallation complète ensuite : sh setup.sh (à la racine).
#

set -e

cd "$(dirname "$0")"

PURGE_IMAGES=0

print_help() {
    cat <<EOF
Usage: $(basename "$0") [options]

Désinstalle toute la stack ParusDB (conteneurs, volumes, données, .env) dans
l'ordre inverse des dépendances. Les images Docker sont conservées sauf avec
--purge-images.

Options :
      --purge-images  Supprimer aussi les images Docker des apps
  -h, --help          Afficher cette aide et sortir

ATTENTION : destructif et irréversible. Les données PostgreSQL (comptes,
conversations, pipelines), les fichiers du lakehouse (Iceberg/RustFS) et les
modèles Ollama téléchargés sont définitivement perdus.
EOF
}

fail() {
    echo "ERREUR : $1" >&2
    exit 1
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --purge-images) PURGE_IMAGES=1 ;;
        -h|--help) print_help; exit 0 ;;
        *) echo "Option inconnue : $1" >&2; print_help; exit 1 ;;
    esac
    shift
done

echo ""
echo "*** ATTENTION : désinstallation complète de la stack ParusDB ***"
echo "*** Conteneurs, volumes, données (Postgres, lakehouse, modèles) ***"
echo "*** et .env de chaque app seront détruits. Les images Docker sont ***"
echo "*** conservées (sauf --purge-images). ***"
echo ""
printf "Confirmer ? (y/N) "
read -r REPLY
case "$REPLY" in
    [Yy]) ;;
    *) echo "Annulé."; exit 0 ;;
esac

# Ordre inverse des dépendances. Polaris avant Supabase : sa réinitialisation
# purge le bucket RustFS du lakehouse, ce qui exige la stack encore debout.
# Les reset.sh interactifs de polaris, trino et mcp-trino sont confirmés par
# `yes` : la confirmation globale ci-dessus couvre toutes leurs options
# (y compris la purge du bucket, cohérente avec une désinstallation totale).
reset_app() {
    app="$1"
    cmd="$2"
    echo ""
    echo "===> [$app] reset..."
    (cd "apps/$app" && sh -c "$cmd")
}

reset_app dlt "sh reset.sh"
reset_app ollama "sh reset.sh -y"
reset_app mcp-trino "yes | sh reset.sh"
reset_app trino "yes | sh reset.sh"
reset_app polaris "yes | sh reset.sh"
reset_app supabase "sh reset.sh -y"

if [ "$PURGE_IMAGES" = "1" ]; then
    echo ""
    echo "===> Suppression des images Docker des apps..."
    for app in supabase polaris trino mcp-trino ollama dlt; do
        # `config --images` liste les images du compose ; les .env ont été
        # remis à zéro, on s'appuie dessus (valeurs d'exemple, valides pour
        # la résolution). Une app sans .env résolvable est ignorée.
        images=$(cd "apps/$app" \
            && docker compose --env-file .env config --images 2>/dev/null || true)
        if [ -n "$images" ]; then
            # shellcheck disable=SC2086
            docker rmi -f $images >/dev/null 2>&1 || true
            echo "    images de [$app] supprimées"
        fi
    done
    # Image du runner dlt, construite localement (hors compose de l'app).
    docker images 'parus-dlt-runner*' --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
        | while IFS= read -r img; do
            [ -n "$img" ] && docker rmi -f "$img" >/dev/null 2>&1 || true
          done
fi

echo ""
echo "Stack ParusDB désinstallée."
echo "Réinstallation complète : sh setup.sh (à la racine)."
echo ""
