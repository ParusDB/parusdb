#!/bin/sh
#
# Cycle de vie de la stack ParusDB complète : orchestration app par app,
# dans l'ordre des dépendances.
#
#   supabase -> polaris -> trino -> mcp-trino -> ollama -> dlt
#
# Chaque app reste pilotable individuellement (cd apps/<app> && sh run.sh …) ;
# ce script ne fait que déléguer dans le bon ordre :
#   - start   : ordre des dépendances (une app ne démarre que si la
#               précédente est saine — chaque run.sh vérifie ses prérequis) ;
#   - stop    : ordre inverse (les dépendances sont coupées en dernier).
#
# Le frontend (apps/nextjs) n'est pas géré ici : serveur de dev au premier
# plan (cd apps/nextjs && npm run dev).
#
# Usage :
#   sh run.sh start [app...]     Démarrer toute la stack (ou des apps ciblées)
#   sh run.sh stop [app...]      Arrêter toute la stack (ou des apps ciblées)
#   sh run.sh restart [app...]  Redémarrer (ordre des dépendances)
#   sh run.sh status             État de toutes les apps
#   sh run.sh logs <app> [service]
#   sh run.sh -h | --help        Cette aide
#
# Apps reconnues : supabase, polaris, trino, mcp-trino, ollama, dlt
#

set -e

cd "$(dirname "$0")"

START_ORDER="supabase polaris trino mcp-trino ollama dlt"
# Ordre inverse pour l'arrêt : les dépendances meurent en dernier.
STOP_ORDER="dlt ollama mcp-trino trino polaris supabase"

print_help() {
    cat <<EOF
Usage: $(basename "$0") <commande> [app...]

Commandes :
  start [app...]     Démarrer toute la stack, ou seulement les apps nommées
  stop [app...]      Arrêter toute la stack, ou seulement les apps nommées
  restart [app...]   Redémarrer (ordre des dépendances)
  status             État de toutes les apps
  logs <app> [service]  Suivre les logs d'une app (tous ses services ou un seul)

Apps : supabase, polaris, trino, mcp-trino, ollama, dlt

Sans app nommée, la commande s'applique à toute la stack dans l'ordre des
dépendances (start) ou l'ordre inverse (stop). Le frontend (apps/nextjs) se
lance à part : cd apps/nextjs && npm run dev.
EOF
}

fail() {
    echo "ERREUR : $1" >&2
    exit 1
}

known_app() {
    case "$1" in
        supabase|polaris|trino|mcp-trino|ollama|dlt) return 0 ;;
        *) return 1 ;;
    esac
}

# Affiche la liste des apps visées : arguments validés tels quels, sinon
# l'ordre par défaut fourni en $1.
resolve_apps() {
    order="$1"
    shift
    if [ "$#" -gt 0 ]; then
        for app in "$@"; do
            known_app "$app" \
                || fail "app inconnue : '$app' (attendu : supabase, polaris, trino, mcp-trino, ollama, dlt)"
        done
        printf '%s\n' "$@"
    else
        # shellcheck disable=SC2086
        printf '%s\n' $order
    fi
}

run_for() {
    app="$1"
    shift
    echo ""
    echo "===> [$app] sh run.sh $*"
    (cd "apps/$app" && sh run.sh "$@")
}

CMD="${1:-help}"
[ "$#" -gt 0 ] && shift

case "$CMD" in
    start)
        for app in $(resolve_apps "$START_ORDER" "$@"); do
            run_for "$app" start
        done
        ;;
    stop)
        for app in $(resolve_apps "$STOP_ORDER" "$@"); do
            # Tolérant : l'arrêt ne doit jamais bloquer sur une app déjà
            # tombée, les suivantes doivent quand même être arrêtées.
            run_for "$app" stop || echo "AVERTISSEMENT : arrêt de [$app] en échec (poursuite)" >&2
        done
        ;;
    restart)
        for app in $(resolve_apps "$START_ORDER" "$@"); do
            run_for "$app" restart
        done
        ;;
    status)
        for app in $START_ORDER; do
            echo ""
            echo "===> [$app]"
            (cd "apps/$app" && sh run.sh status) || true
        done
        ;;
    logs)
        [ "$#" -ge 1 ] || fail "Usage : sh run.sh logs <app> [service]"
        known_app "$1" || fail "app inconnue : '$1'"
        app="$1"
        shift
        (cd "apps/$app" && sh run.sh logs "$@")
        ;;
    -h|--help|help)
        print_help
        ;;
    *)
        echo "Commande inconnue : '$CMD'" >&2
        print_help
        exit 1
        ;;
esac
