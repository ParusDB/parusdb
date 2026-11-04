#!/bin/sh
#
# E2E « moteur ELT » ParusDB — exécution manuelle uniquement
# (.github/workflows/e2e-elt.yml, workflow_dispatch ; AGENTS.md §13).
#
# Objectif : prouver sur un runner disposable que le parcours complet
# fonctionne, de l'installation à la donnée requêtable :
#
#   1. stack Supabase (db, RustFS, Kong) + schéma applicatif ;
#   2. Apache Polaris (catalogues system + environnement) ;
#   3. Trino durci (HTTPS + access control) ;
#   4. moteur dlt (rôle parus_dlt + ordonnanceur) ;
#   5. sources de démo (PostgreSQL + Kafka, apps/dlt/demo) ;
#   6. deux pipelines (demo-pg-sales, demo-kafka-events) créés en SQL avec
#      credentials chiffrés, comme le fait l'interface ;
#   7. exécution des runs puis assertions : les lignes servies par Trino
#      (Iceberg/Polaris) sont identiques aux lignes des sources.
#
# NON couvert (hors périmètre de ce test) : Ollama (GPU absent sur les
# runners), mcp-trino et le Chat IA (sh apps/ollama/run.sh test sur une
# machine avec GPU), le frontend (Playwright à venir).
#
# Prérequis : docker + compose, openssl, python3 inutile côté hôte (le
# chiffrement des credentials tourne dans l'image du runner dlt).
# Jamais de secret affiché ni commité : tout est généré puis jeté avec le
# runner.
#
# Usage : sh scripts/ci/e2e-elt.sh
#

set -e

cd "$(dirname "$0")/../.."
ROOT=$(pwd)

log() { printf '\n=== %s\n' "$*"; }
step() { printf '\n===> %s\n' "$*"; }
fail() { echo "ERREUR : $1" >&2; exit 1; }

read_env_var() {
    # read_env_var <fichier> <variable>
    [ -f "$1" ] || return 0
    grep "^$2=" "$1" | head -n 1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//'
}

# ---------------------------------------------------------------------------
# 1. Stack Supabase
# ---------------------------------------------------------------------------
log "E2E ELT ParusDB - installation éphémère"

step "[supabase] .env + secrets"
cp apps/supabase/.env.example apps/supabase/.env
(cd apps/supabase && sh utils/generate-keys.sh --update-env >/dev/null 2>&1) \
    || fail "génération des secrets Supabase impossible"

step "[supabase] overrides compose + démarrage"
(cd apps/supabase && sh run.sh config add kong rustfs rustfs-restart auth-sessions) >/dev/null
(cd apps/supabase && sh run.sh start) >/dev/null \
    || fail "la stack Supabase n'a pas démarré"

step "[supabase] schéma applicatif"
docker exec -i supabase-db psql -U supabase_admin -d postgres \
    -v ON_ERROR_STOP=1 < apps/supabase/sql/01-parusdb-app.sql >/dev/null

step "[supabase] exposition PostgREST des schémas métier"
WANT_SCHEMAS="public,graphql_public,iam,agents,chat,lakehouse,connectors,admin"
sed -i "s|^PGRST_DB_SCHEMAS=.*|PGRST_DB_SCHEMAS=$WANT_SCHEMAS|" apps/supabase/.env
(cd apps/supabase && sh run.sh up rest) >/dev/null

# ---------------------------------------------------------------------------
# 2. Polaris puis Trino (catalogues + durcissement)
# ---------------------------------------------------------------------------
step "[polaris] setup"
(cd apps/polaris && sh setup.sh) >"$ROOT/.e2e-polaris.log" 2>&1 \
    || { tail -20 "$ROOT/.e2e-polaris.log"; fail "setup Polaris en échec"; }

step "[supabase] seed des catalogues lakehouse"
SYSTEM_CATALOG=$(read_env_var apps/polaris/.env POLARIS_SYSTEM_CATALOG)
DEFAULT_CATALOG=$(read_env_var apps/polaris/.env POLARIS_DEFAULT_CATALOG)
docker exec -i supabase-db psql -U supabase_admin -d postgres \
    -v system_catalog="$SYSTEM_CATALOG" \
    -v default_catalog="$DEFAULT_CATALOG" \
    < apps/supabase/sql/02-lakehouse-catalogs.sql >/dev/null

step "[trino] setup"
(cd apps/trino && sh setup.sh) >"$ROOT/.e2e-trino.log" 2>&1 \
    || { tail -20 "$ROOT/.e2e-trino.log"; fail "setup Trino en échec"; }

# ---------------------------------------------------------------------------
# 3. Moteur dlt
# ---------------------------------------------------------------------------
step "[dlt] clé de chiffrement + setup"
# Le setup dlt importe PARUSDB_ENCRYPTION_KEY depuis apps/nextjs/.env (ou
# .env.local) : on n'écrit que cette clé, jamais de valeur Supabase.
if [ ! -f apps/nextjs/.env ]; then
    printf 'PARUSDB_ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" > apps/nextjs/.env
fi
(cd apps/dlt && sh setup.sh) >"$ROOT/.e2e-dlt.log" 2>&1 \
    || { tail -20 "$ROOT/.e2e-dlt.log"; fail "setup dlt en échec"; }

# ---------------------------------------------------------------------------
# 4. Sources de démo + pipelines
# ---------------------------------------------------------------------------
step "[demo] sources PostgreSQL + Kafka"
(cd apps/dlt/demo && docker compose -f docker-compose.yml -f docker-compose.kafka.yml up -d --wait) \
    || fail "les sources de démo n'ont pas démarré"
sleep 3

step "[demo] messages Kafka (12 évènements JSON)"
i=1
while [ "$i" -le 12 ]; do
    printf '{"event_id": %s, "customer_id": %s, "amount": %s.00, "status": "reglee", "event_time": "2024-11-%02dT10:00:00Z"}\n' \
        "$i" "$(( (i % 5) + 1 ))" "$(( 20 + i ))" "$(( i + 10 ))" \
        | docker exec -i parus-dlt-demo-kafka rpk topic produce ventes_evenements \
            --key "evt-$i" >/dev/null 2>&1
    i=$(( i + 1 ))
done

step "[pipelines] compte propriétaire + SQL credentials chiffrés"
# Le trigger iam.on_auth_user_created attribue le rôle admin au premier
# compte : on crée l'utilisateur e2e AVANT le seed des pipelines.
E2E_USER_ID=$(docker exec supabase-db psql -U supabase_admin -d postgres -tAc \
    "insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
     values ('00000000-0000-4000-8000-0000000000aa', 'authenticated', 'authenticated',
             'e2e-elt@ci.parusdb.local', now(), '{}', '{}')
     on conflict (id) do update set email = excluded.email
     returning id")
[ -n "$E2E_USER_ID" ] || fail "création du compte e2e impossible"

# Le générateur tourne dans l'image du runner (cryptography + schéma exact
# du BFF) et écrit le SQL côté hôte ; la clé PARUSDB_ENCRYPTION_KEY est lue
# dans apps/dlt/.env, jamais affichée.
DLT_IMAGE=$(read_env_var apps/dlt/.env PARUSDB_DLT_IMAGE)
docker run --rm -v "$ROOT/apps/dlt:/work" -w /work --entrypoint python "$DLT_IMAGE" \
    demo/gen_pipelines_seed.py --owner "$E2E_USER_ID" \
    || fail "génération du SQL des pipelines impossible"
docker exec -i supabase-db psql -U supabase_admin -d postgres \
    -v ON_ERROR_STOP=1 < apps/dlt/demo/.pipelines-seed.sql >/dev/null
rm -f apps/dlt/demo/.pipelines-seed.sql

# ---------------------------------------------------------------------------
# 5. Exécution + assertions
# ---------------------------------------------------------------------------
step "[runs] attente des deux chargements (timeout 12 min)"
n=0
while [ "$n" -lt 72 ]; do
    pending=$(docker exec supabase-db psql -U supabase_admin -d postgres -tAc \
        "select count(*) from connectors.pipeline_runs r
          where r.status in ('queued', 'running')")
    [ "$pending" = "0" ] && break
    sleep 10
    n=$(( n + 1 ))
done
[ "$pending" = "0" ] || fail "les runs n'ont pas terminé en 12 minutes"

step "[runs] statuts finaux"
docker exec supabase-db psql -U supabase_admin -d postgres -c \
    "select p.name, r.status, r.rows_loaded from connectors.pipeline_runs r
      join connectors.pipelines p on p.id = r.pipeline_id order by p.name"
bad=$(docker exec supabase-db psql -U supabase_admin -d postgres -tAc \
    "select count(*) from connectors.pipeline_runs r where r.status <> 'success'")
[ "$bad" = "0" ] || {
    docker exec supabase-db psql -U supabase_admin -d postgres -tAc \
        "select p.name, r.status, coalesce(r.log, '') from connectors.pipeline_runs r
          join connectors.pipelines p on p.id = r.pipeline_id where r.status <> 'success'" | tail -40
    fail "au moins un run est en échec (journal ci-dessus)"
}

step "[assertions] parité sources -> Trino"
trino_cli() {
    # trino_cli <requête> : compte outillage parus-ops (accès complet).
    PW=$(read_env_var apps/trino/.env TRINO_OPS_PASSWORD)
    OPS_USER=$(read_env_var apps/trino/.env TRINO_OPS_USER)
    (cd apps/trino && docker compose exec -T -e TRINO_PASSWORD="$PW" trino trino \
        --server https://localhost:8443 --user "$OPS_USER" \
        --password --insecure --execute "$1" 2>/dev/null | tr -d '"')
}

PG_CUSTOMERS=$(docker exec parus-dlt-demo-postgres psql -U demo -d demo_sales -tAc \
    "select count(*) from customers")
PG_ORDERS=$(docker exec parus-dlt-demo-postgres psql -U demo -d demo_sales -tAc \
    "select count(*) from orders")
KAFKA_MESSAGES=$(docker exec parus-dlt-demo-kafka rpk topic describe ventes_evenements -p 2>/dev/null \
    | awk '/^0 /{print $NF}')

check() {
    # check <attendu> <obtenu> <contexte>
    if [ "$1" != "$2" ]; then
        fail "assertion « $3 » : attendu $1, obtenu $2"
    fi
    printf '    OK %s (%s lignes)\n' "$3" "$1"
}

check "$PG_CUSTOMERS" "$(trino_cli "select count(*) from $DEFAULT_CATALOG.ventes_demo.customers")" "PostgreSQL customers -> dev.ventes_demo.customers"
check "$PG_ORDERS" "$(trino_cli "select count(*) from $DEFAULT_CATALOG.ventes_demo.orders")" "PostgreSQL orders -> dev.ventes_demo.orders"
check "$KAFKA_MESSAGES" "$(trino_cli "select count(*) from $DEFAULT_CATALOG.evenements_kafka.ventes_evenements")" "Kafka ventes_evenements -> dev.evenements_kafka.ventes_evenements"

log "E2E ELT : SUCCÈS"
echo "    - 2 pipelines chargés (PostgreSQL + Kafka), données requêtables dans Trino"
