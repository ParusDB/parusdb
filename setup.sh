#!/bin/sh
#
# Première installation de la plateforme ParusDB : orchestration complète,
# dans l'ordre des dépendances. Chaque étape est idempotente — le script est
# relançable sans risque (il resynchronise les secrets et redémarre propre).
#
#   1. stack Supabase : .env, secrets régénérés si valeurs vendor par défaut,
#      overrides Kong + RustFS, démarrage, schéma applicatif, exposition
#      PostgREST des schémas métier ;
#   2. Apache Polaris : setup (démarrage, catalogue système `parusdb` puis
#      catalogue d'environnement) + seed applicatif des catalogues
#      (descriptions, RBAC — apps/supabase/sql/02-lakehouse-catalogs.sql) ;
#   3. Trino : setup (démarrage + bindings de catalogues) ;
#   4. mcp-trino puis Ollama : setup (modèles re-téléchargés si absents) ;
#   5. synchronisation de apps/nextjs/.env.local (clés Supabase, credentials
#      Polaris, clé de chiffrement) — sans jamais les afficher ;
#   6. moteur dlt : setup (importe la clé de chiffrement) puis vérification.
#
# Usage :
#   sh setup.sh              # installation complète
#   sh setup.sh -h | --help  # aide
#
# Le frontend n'est pas démarré ici : cd apps/nextjs && npm run dev.
# Après installation : ouvrir l'app et suivre l'onboarding du premier
# utilisateur (rôle Administrateur attribué automatiquement).
#

set -e

cd "$(dirname "$0")"
ROOT=$(pwd)

print_help() {
    cat <<EOF
Usage: $(basename "$0") [options]

Installe et démarre toute la stack ParusDB dans l'ordre des dépendances
(supabase, polaris, trino, mcp-trino, ollama, dlt), resynchronise
apps/nextjs/.env.local puis vérifie le moteur ELT.

Options :
  -h, --help    Afficher cette aide et sortir
EOF
}

fail() {
    echo "ERREUR : $1" >&2
    exit 1
}

log() {
    printf '===> %s\n' "$*"
}

# Jamais en root : lancé par sudo, ce script (et ceux des apps qu'il
# délègue) crée des `.env` appartenant à root (mode 600), qui bloquent
# ensuite toutes les exécutions utilisateur par « permission denied »
# (incident réel). Les suppressions privilégiées (fichiers de volumes
# appartenant à root) passent déjà par des conteneurs éphémères busybox.
if [ "$(id -u)" = "0" ]; then
    fail "ne lancez pas ce script en root/sudo : il créerait des .env appartenant à root. Lancez-le en utilisateur normal."
fi

# Lecture d'une variable KEY=VALUE dans un fichier .env (sans le sourcer).
read_env_var() {
    [ -f "$1" ] || return 0
    grep "^$2=" "$1" | head -n 1 | cut -d= -f2- | tr -d "\r" | sed -e "s/^\"//" -e "s/\"$//"
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        -h|--help) print_help; exit 0 ;;
        *) echo "Option inconnue : $1" >&2; print_help; exit 1 ;;
    esac
    shift
done

echo ""
echo "ParusDB — installation de la stack complète"
echo ""

log "Vérification des prérequis..."
command -v docker >/dev/null 2>&1 || fail "docker est requis"
docker compose version >/dev/null 2>&1 || fail "le plugin docker compose est requis"
command -v openssl >/dev/null 2>&1 || fail "openssl est requis"

# ---------------------------------------------------------------------------
# 1. Stack Supabase
# ---------------------------------------------------------------------------
log "[supabase] préparation du .env..."
if [ ! -f "apps/supabase/.env" ]; then
    [ -f "apps/supabase/.env.example" ] \
        || fail "apps/supabase/.env.example introuvable"
    cp "apps/supabase/.env.example" "apps/supabase/.env"
    echo "    .env créé depuis .env.example"
fi

# Secrets vendor par défaut (reset ou clone frais) -> régénération. La sortie
# de generate-keys.sh imprime les secrets : jamais l'afficher.
JWT_NOW=$(read_env_var "apps/supabase/.env" JWT_SECRET)
JWT_EXAMPLE=$(read_env_var "apps/supabase/.env.example" JWT_SECRET)
if [ -n "$JWT_EXAMPLE" ] && [ "$JWT_NOW" = "$JWT_EXAMPLE" ]; then
    log "[supabase] secrets vendor détectés : régénération..."
    (cd apps/supabase && sh utils/generate-keys.sh --update-env >/dev/null 2>&1)
    echo "    secrets régénérés (jamais affichés)"
else
    echo "    secrets déjà générés (conservés)"
fi

log "[supabase] overrides compose (Kong, RustFS, restart RustFS, sessions auth)..."
(cd apps/supabase && sh run.sh config add kong rustfs rustfs-restart auth-sessions) >/dev/null
echo "    overrides enregistrés"

log "[supabase] démarrage de la stack..."
(cd apps/supabase && sh run.sh start) >/dev/null
echo "    stack démarrée et saine"

log "[supabase] application du schéma applicatif (01-parusdb-app.sql)..."
# ON_ERROR_STOP + code de sortie vérifié : un échec silencieux laisserait la
# base sans schémas métier et PostgREST unhealthy (incident réel).
if ! docker exec -i supabase-db psql -U supabase_admin -d postgres \
        -v ON_ERROR_STOP=1 \
        < "apps/supabase/sql/01-parusdb-app.sql" >/dev/null; then
    fail "l'application du schéma applicatif a échoué — installation interrompue"
fi
echo "    schéma applicatif appliqué (idempotent)"

log "[supabase] exposition PostgREST des schémas métier (PGRST_DB_SCHEMAS)..."
# Le .env régénéré par un reset ne contient que public,graphql_public : sans
# cette ligne, PostgREST répond PGRST205 et le frontend ne voit aucun rôle.
WANT_SCHEMAS="public,graphql_public,iam,agents,chat,lakehouse,connectors,admin"
HAVE_SCHEMAS=$(read_env_var "apps/supabase/.env" PGRST_DB_SCHEMAS)
if [ "$HAVE_SCHEMAS" = "$WANT_SCHEMAS" ]; then
    echo "    PGRST_DB_SCHEMAS déjà conforme"
else
    sed -i "s|^PGRST_DB_SCHEMAS=.*|PGRST_DB_SCHEMAS=$WANT_SCHEMAS|" apps/supabase/.env
    # Une modification du .env exige une recréation, pas un simple restart.
    (cd apps/supabase && sh run.sh up rest) >/dev/null
    echo "    PGRST_DB_SCHEMAS mis à jour, conteneur rest recréé"
fi

# ---------------------------------------------------------------------------
# 2. Apache Polaris (catalogue Iceberg)
# ---------------------------------------------------------------------------
log "[polaris] setup (rôle, base, bucket, clés RSA, catalogue système + catalogue par défaut)..."
(cd apps/polaris && sh setup.sh)
echo "    Polaris prêt"

# ---------------------------------------------------------------------------
# 2b. Seed applicatif des catalogues d'installation (descriptions + RBAC)
# ---------------------------------------------------------------------------
log "[supabase] seed des catalogues lakehouse (02-lakehouse-catalogs.sql)..."
SYSTEM_CATALOG=$(read_env_var "apps/polaris/.env" POLARIS_SYSTEM_CATALOG)
DEFAULT_CATALOG=$(read_env_var "apps/polaris/.env" POLARIS_DEFAULT_CATALOG)
if [ -n "$SYSTEM_CATALOG" ] && [ -n "$DEFAULT_CATALOG" ]; then
    docker exec -i supabase-db psql -U supabase_admin -d postgres \
        -v system_catalog="$SYSTEM_CATALOG" \
        -v default_catalog="$DEFAULT_CATALOG" \
        < "apps/supabase/sql/02-lakehouse-catalogs.sql" >/dev/null
    echo "    catalogues '$SYSTEM_CATALOG' et '$DEFAULT_CATALOG' enregistrés (descriptions + accès)"
else
    echo "    AVERTISSEMENT : POLARIS_SYSTEM_CATALOG ou POLARIS_DEFAULT_CATALOG vide — seed sauté"
fi

# ---------------------------------------------------------------------------
# 3. Trino (moteur SQL)
# ---------------------------------------------------------------------------
log "[trino] setup (.env, bindings de catalogues, test e2e)..."
(cd apps/trino && sh setup.sh)
echo "    Trino prêt"

# ---------------------------------------------------------------------------
# 4. mcp-trino puis Ollama
# ---------------------------------------------------------------------------
log "[mcp-trino] setup..."
(cd apps/mcp-trino && sh setup.sh)
echo "    mcp-trino prêt"

log "[ollama] setup (les modèles sont re-téléchargés si absents)..."
(cd apps/ollama && sh setup.sh)
echo "    Ollama prêt"

# ---------------------------------------------------------------------------
# 5. Synchronisation de apps/nextjs/.env.local
# ---------------------------------------------------------------------------
# Les clés Supabase et les credentials Polaris sont régénérés par les setup ;
# le frontend doit les suivre. Aucune valeur n'est affichée.
log "[nextjs] synchronisation de .env.local..."
NEXTJS_ENV_LOCAL="apps/nextjs/.env.local"
if [ ! -f "$NEXTJS_ENV_LOCAL" ]; then
    [ -f "apps/nextjs/.env.example" ] || fail "apps/nextjs/.env.example introuvable"
    cp "apps/nextjs/.env.example" "$NEXTJS_ENV_LOCAL"
    echo "    .env.local créé depuis .env.example"
fi

sync_var() {
    # sync_var <fichier> <variable> <fichier source> <variable source>
    target_file="$1"; target_var="$2"; source_file="$3"; source_var="$4"
    value=$(read_env_var "$source_file" "$source_var")
    [ -n "$value" ] || fail "$source_var absent de $source_file"
    if grep -q "^${target_var}=" "$target_file"; then
        escaped=$(printf '%s' "$value" | sed 's/[&|/]/\\&/g')
        sed -i "s|^${target_var}=.*|${target_var}=${escaped}|" "$target_file"
    else
        printf '%s=%s\n' "$target_var" "$value" >> "$target_file"
    fi
}

sync_var "$NEXTJS_ENV_LOCAL" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "apps/supabase/.env" ANON_KEY
sync_var "$NEXTJS_ENV_LOCAL" SUPABASE_SERVICE_ROLE_KEY "apps/supabase/.env" SERVICE_ROLE_KEY
sync_var "$NEXTJS_ENV_LOCAL" POLARIS_ROOT_CLIENT_ID "apps/polaris/.env" POLARIS_ROOT_CLIENT_ID
sync_var "$NEXTJS_ENV_LOCAL" POLARIS_ROOT_CLIENT_SECRET "apps/polaris/.env" POLARIS_ROOT_CLIENT_SECRET
sync_var "$NEXTJS_ENV_LOCAL" POLARIS_SYSTEM_CATALOG "apps/polaris/.env" POLARIS_SYSTEM_CATALOG
sync_var "$NEXTJS_ENV_LOCAL" POLARIS_S3_BUCKET "apps/polaris/.env" POLARIS_S3_BUCKET
# Mot de passe Trino du compte de service BFF (durcissement, rbac_refonte.md
# §9) : TRINO_SERVICE_PASSWORD généré par apps/trino/setup.sh.
sync_var "$NEXTJS_ENV_LOCAL" TRINO_PASSWORD "apps/trino/.env" TRINO_SERVICE_PASSWORD
# Clés S3 (RustFS) : affichées côté administration (/admin/informations)
# pour les outils qui écrivent directement dans l'object storage (Airbyte).
sync_var "$NEXTJS_ENV_LOCAL" S3_ACCESS_KEY_ID "apps/polaris/.env" S3_ACCESS_KEY_ID
sync_var "$NEXTJS_ENV_LOCAL" S3_SECRET_ACCESS_KEY "apps/polaris/.env" S3_SECRET_ACCESS_KEY

# Clé de chiffrement des credentials (AES-256-GCM) : partagée avec le moteur
# dlt (apps/dlt/.env l'importe depuis .env.local). Générée si absente.
if [ -z "$(read_env_var "$NEXTJS_ENV_LOCAL" PARUSDB_ENCRYPTION_KEY)" ]; then
    key=$(openssl rand -hex 32)
    if grep -q "^PARUSDB_ENCRYPTION_KEY=" "$NEXTJS_ENV_LOCAL"; then
        sed -i "s|^PARUSDB_ENCRYPTION_KEY=.*|PARUSDB_ENCRYPTION_KEY=$key|" "$NEXTJS_ENV_LOCAL"
    else
        printf 'PARUSDB_ENCRYPTION_KEY=%s\n' "$key" >> "$NEXTJS_ENV_LOCAL"
    fi
    echo "    PARUSDB_ENCRYPTION_KEY générée"
fi
echo "    clés Supabase, credentials Polaris et clé de chiffrement synchronisés"

# ---------------------------------------------------------------------------
# 6. Moteur dlt (ELT)
# ---------------------------------------------------------------------------
log "[dlt] setup (rôle PostgreSQL, .env, ordonnanceur)..."
(cd apps/dlt && sh setup.sh)
echo "    dlt prêt"

log "[dlt] vérification (runner, Postgres, Polaris)..."
(cd apps/dlt && sh run.sh verify)

echo ""
echo "Stack ParusDB installée et démarrée."
echo "  Frontend     : cd apps/nextjs && npm run dev  (http://localhost:3000)"
echo "  Premier user : l'onboarding propose le rôle Administrateur au premier"
echo "                 compte créé (aucune confirmation email requise)."
echo ""
