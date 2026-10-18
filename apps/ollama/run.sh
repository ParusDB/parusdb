#!/bin/sh
#
# Gérer la stack Ollama de ParusDB (docker compose).
#
# Ollama est autonome : aucun réseau partagé avec les autres stacks, il
# expose son API HTTP sur le port hôte OLLAMA_PORT. Les modèles n'accèdent
# aux données que via mcp-trino (apps/mcp-trino), jamais directement.
#
# Usage :
#   sh run.sh start                  # docker compose up -d --wait
#   sh run.sh stop                   # docker compose down
#   sh run.sh restart                # redémarrer la stack
#   sh run.sh recreate               # stop puis start
#   sh run.sh status                 # docker compose ps
#   sh run.sh logs                   # suivre les logs
#   sh run.sh cli [modèle]           # chat interactif (modèle par défaut sinon)
#   sh run.sh list                   # modèles installés (ollama list)
#   sh run.sh ps                     # modèles chargés en mémoire (ollama ps)
#   sh run.sh pull [modèle]          # télécharger un modèle (OLLAMA_MODELS sinon)
#   sh run.sh gpu                    # vérifier le GPU vu par le conteneur
#   sh run.sh test [question]        # test e2e : LLM → mcp-trino → Trino
#   sh run.sh inspect                # docker inspect du conteneur
#   sh run.sh printenv               # variables d'environnement du conteneur
#   sh run.sh pull-images            # tirer l'image docker compose
#   sh run.sh compose-config         # afficher la configuration compose résolue
#

set -e

cd "$(dirname "$0")"

if [ ! -f docker-compose.yml ]; then
    echo "ERREUR : docker-compose.yml introuvable dans $(pwd)" >&2
    exit 1
fi

if [ ! -f .env ]; then
    echo "ERREUR : .env introuvable — lancez d'abord 'sh setup.sh'" >&2
    exit 1
fi

read_env_var() {
    grep "^$2=" "$1" | head -n 1 | cut -d= -f2- | tr -d "\r" | sed -e "s/^\"//" -e "s/\"$//"
}

get_env_value() {
    read_env_var .env "$1"
}

CMD="${1:-help}"
[ "$#" -gt 0 ] && shift

case "$CMD" in
    start|up)
        exec docker compose up -d --wait "$@"
        ;;
    stop|down)
        exec docker compose down "$@"
        ;;
    restart)
        exec docker compose restart "$@"
        ;;
    recreate)
        if [ "$#" -eq 0 ]; then
            docker compose down
            exec docker compose up -d --wait
        fi
        exec docker compose up -d --wait --force-recreate --no-deps "$@"
        ;;
    status|ps|compose-ps)
        exec docker compose ps "$@"
        ;;
    logs)
        exec docker compose logs -f "$@"
        ;;
    cli)
        model="${1:-$(get_env_value OLLAMA_DEFAULT_MODEL)}"
        [ -n "$model" ] || { echo "ERREUR : précisez un modèle (sh run.sh cli gemma4:e2b)" >&2; exit 1; }
        echo "Chat interactif avec '$model' — /bye ou Ctrl-D pour sortir."
        exec docker compose exec ollama ollama run "$model"
        ;;
    list|models)
        exec docker compose exec -T ollama ollama list
        ;;
    loaded)
        exec docker compose exec -T ollama ollama ps
        ;;
    pull)
        if [ "$#" -gt 0 ]; then
            exec docker compose exec -T ollama ollama pull "$1"
        fi
        for model in $(get_env_value OLLAMA_MODELS); do
            [ -n "$model" ] || continue
            docker compose exec -T ollama ollama pull "$model"
        done
        ;;
    gpu)
        echo "===> GPU vu par le conteneur :"
        docker compose exec -T ollama nvidia-smi || {
            echo "ERREUR : nvidia-smi indisponible dans le conteneur." >&2
            echo "Le runtime docker \`nvidia\` est-il configuré ? (cd apps/ollama && sh setup.sh)" >&2
            exit 1
        }
        echo ""
        echo "===> Modèles chargés (colonne GPU = part sur la carte) :"
        docker compose exec -T ollama ollama ps
        ;;
    test)
        question="$*"
        if [ -n "$question" ]; then
            set -- --question "$question"
        fi
        # LD_LIBRARY_PATH (ex. extensions VS Code embarquant leurs propres
        # bibliothèques) peut casser le binaire node système : on le retire
        # s'il est défini.
        if [ -n "$LD_LIBRARY_PATH" ]; then
            exec env -u LD_LIBRARY_PATH node "$PWD/scripts/test-mcp-trino.mjs" "$@"
        fi
        exec node "$PWD/scripts/test-mcp-trino.mjs" "$@"
        ;;
    inspect)
        cid=$(docker compose ps -q ollama)
        [ -z "$cid" ] && { echo "Le service 'ollama' n'est pas en cours d'exécution" >&2; exit 1; }
        exec docker inspect "$cid" "$@"
        ;;
    printenv)
        cid=$(docker compose ps -q ollama)
        [ -z "$cid" ] && { echo "Le service 'ollama' n'est pas en cours d'exécution" >&2; exit 1; }
        exec docker inspect --format='{{range .Config.Env}}{{println .}}{{end}}' "$cid"
        ;;
    pull-images)
        exec docker compose pull "$@"
        ;;
    compose-config)
        exec docker compose config "$@"
        ;;
    help|-h|--help)
        cat <<EOF
Usage : $(basename "$0") <commande>

Commandes :
  start                Démarrer la stack (docker compose up -d --wait)
  stop                 Arrêter la stack (docker compose down)
  restart              Redémarrer la stack
  recreate             Stop puis start, ou force-recreate (--no-deps)
  status               Afficher le statut des services
  logs                 Suivre les logs
  cli [modèle]         Chat interactif (OLLAMA_DEFAULT_MODEL par défaut)
  list                 Modèles installés (ollama list)
  loaded               Modèles chargés en mémoire (ollama ps)
  pull [modèle]        Télécharger un modèle (tous OLLAMA_MODELS si omis)
  gpu                  Vérifier le GPU vu par le conteneur
  test [question]      Test e2e Chat IA : question → LLM → mcp-trino → Trino
  inspect              Inspecter le conteneur (args transmis à docker inspect)
  printenv             Afficher les variables d'environnement du conteneur
  pull-images          Tirer l'image docker compose
  compose-config       Afficher la configuration compose entièrement résolue

EOF
        ;;
    *)
        echo "Commande inconnue : $CMD" >&2
        echo "Lancez '$0 help' pour l'usage." >&2
        exit 1
        ;;
esac
