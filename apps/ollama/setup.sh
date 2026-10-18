#!/bin/sh
#
# Bootstrap d'Ollama pour ParusDB.
#
# Prérequis : GPU NVIDIA + NVIDIA Container Toolkit configuré pour Docker
# (runtime `nvidia`). Sans lui, le conteneur ne peut pas accéder au GPU.
#
# Étapes (toutes idempotentes, le script est relançable sans risque) :
#   1. vérification des prérequis (docker, compose, toolkit NVIDIA) ;
#   2. création de .env depuis .env.example si absent ;
#   3. démarrage de la stack compose ;
#   4. téléchargement des modèles listés dans OLLAMA_MODELS ;
#   5. test de bout en bout : génération sur le modèle par défaut, puis
#      affichage du GPU utilisé (`ollama ps`).
#
# Usage :
#   sh setup.sh               # bootstrap complet puis démarrage
#   sh setup.sh --skip-start  # tout préparer sans démarrer la stack
#   sh setup.sh -h | --help   # aide
#

set -e

cd "$(dirname "$0")"

SCRIPT_DIR=$(pwd)
LOCAL_ENV="$SCRIPT_DIR/.env"

print_help() {
    cat <<EOF
Usage: $(basename "$0") [options]

Options:
      --skip-start   Préparer tout (.env, modèles) sans démarrer la stack
  -h, --help          Afficher cette aide et sortir

Prérequis : NVIDIA Container Toolkit installé et configuré
(https://docs.ollama.com/docker)
EOF
}

fail() {
    echo "ERREUR : $1" >&2
    exit 1
}

read_env_var() {
    [ -f "$1" ] || return 0
    grep "^$2=" "$1" | head -n 1 | cut -d= -f2- | tr -d "\r" | sed -e "s/^\"//" -e "s/\"$//"
}

get_env_value() {
    read_env_var "$LOCAL_ENV" "$1"
}

SKIP_START=0
while [ $# -gt 0 ]; do
    case "$1" in
        --skip-start) SKIP_START=1 ;;
        -h|--help) print_help; exit 0 ;;
        *) echo "Option inconnue : $1" >&2; print_help; exit 1 ;;
    esac
    shift
done

echo "===> Vérification des prérequis..."
command -v docker >/dev/null 2>&1 || fail "docker est requis (https://docs.docker.com/engine/install/)"
docker compose version >/dev/null 2>&1 || fail "le plugin docker compose est requis"

# GPU NVIDIA : toolkit + runtime docker `nvidia`.
command -v nvidia-smi >/dev/null 2>&1 \
    || fail "aucun GPU NVIDIA détecté (nvidia-smi absent) : cette stack requiert le NVIDIA Container Toolkit (https://docs.ollama.com/docker)"
docker info 2>/dev/null | grep -q "nvidia" \
    || fail "le runtime docker \`nvidia\` n'est pas configuré. Procédure (https://docs.ollama.com/docker) :
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \\
      | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \\
      | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \\
      | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
  sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
  sudo nvidia-ctk runtime configure --runtime=docker
  sudo systemctl restart docker
Puis relancez ce script."

echo "===> Préparation de .env..."
if [ ! -f "$LOCAL_ENV" ]; then
    cp "$SCRIPT_DIR/.env.example" "$LOCAL_ENV"
    echo "    .env créé depuis .env.example"
fi

if [ "$SKIP_START" = "1" ]; then
    echo ""
    echo "Préparation terminée (--skip-start : stack non démarrée)."
    echo "Démarrage manuel : sh run.sh start"
    exit 0
fi

echo "===> Démarrage de la stack Ollama..."
docker compose up -d --wait
echo "    ollama est démarré et sain"

echo "===> Téléchargement des modèles (OLLAMA_MODELS)..."
for model in $(get_env_value OLLAMA_MODELS); do
    [ -n "$model" ] || continue
    echo "    ollama pull $model"
    docker compose exec -T ollama ollama pull "$model"
done

echo ""
DEFAULT_MODEL=$(get_env_value OLLAMA_DEFAULT_MODEL)
if [ -n "$DEFAULT_MODEL" ]; then
    echo "===> Test de génération sur '$DEFAULT_MODEL' (premier chargement : peut prendre quelques dizaines de secondes)..."
    docker compose exec -T ollama ollama run "$DEFAULT_MODEL" "Réponds uniquement par le mot OK."
    echo ""
    echo "===> Modèle chargé en mémoire (colonne GPU = part sur la carte) :"
    docker compose exec -T ollama ollama ps
fi

echo ""
echo "Ollama est prêt."
echo "  API HTTP             : http://localhost:$(get_env_value OLLAMA_PORT)"
echo "  Chat interactif      : sh run.sh cli"
echo "  Modèles installés    : sh run.sh list"
echo "  Test e2e Chat IA     : sh run.sh test   (requiert apps/mcp-trino démarré)"
echo ""
