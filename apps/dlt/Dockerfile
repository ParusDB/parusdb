# syntax=docker/dockerfile:1
#
# Runner dlt de ParusDB — image unique pour :
#   - les conteneurs jetables d'exécution (un conteneur par run, AGENTS.md §12) ;
#   - l'ordonnanceur des pipelines (service compose, commande `schedule`) ;
#   - l'introspection des sources (commande `introspect`, appelée par le BFF).
#
# Contenu :
#   - dlt épinglé + extras (pyiceberg = destination Iceberg, sql-database,
#     http = REST APIs, s3/gs/gcp/sftp/filesystem = object store) ;
#   - pilotes SQL (PostgreSQL, MySQL/MariaDB, SQL Server ; SQLite natif) ;
#   - sources verified du dépôt officiel dlt-hub/verified-sources, vendées à
#     un commit épinglé (aucun package PyPI ne les publie) : le code vit dans
#     /app/vendor/sources (PYTHONPATH), leurs requirements sont installés.
#
# Reconstruction : cd apps/dlt && sh run.sh build

FROM python:3.12-slim AS verified-sources

# Commit épinglé du dépôt officiel (mettre à jour consciemment : les sources
# verified évoluent avec les versions de dlt).
ARG VERIFIED_SOURCES_SHA=3957506893a7da821dbcc6acd51c7ca4475d1f53

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /vendor
RUN git clone --quiet https://github.com/dlt-hub/verified-sources.git repo \
    && cd repo \
    && git checkout --quiet ${VERIFIED_SOURCES_SHA} \
    && rm -rf .git

# Fusion des requirements des sources verified, hors `dlt` (installé à la
# version épinglée par l'image elle-même) et hors doublons.
RUN mkdir -p /vendor/reqs \
    && cd /vendor/repo/sources \
    && for f in */requirements.txt; do \
           grep -h -E '^[a-zA-Z0-9_.-]+' "$f" \
             | grep -v -E '^dlt([\[>=< ]|$)' >> /vendor/reqs/merged.txt || true; \
       done \
    && sort -u /vendor/reqs/merged.txt > /vendor/reqs/all.txt \
    && wc -l /vendor/reqs/all.txt


FROM python:3.12-slim

ARG DLT_VERSION=1.31.0

ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app:/app/vendor/sources \
    HOME=/var/lib/dlt \
    TZ=UTC \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/dlt

# dlt épinglé + extras (destination Iceberg via pyiceberg, sources Core) et
# dépendances du runner (pilotes SQL, ordonnanceur CRON, SDK Docker, crypto).
RUN pip install \
        "dlt[pyiceberg,sql-database,sqlalchemy,http,s3,gs,gcp,filesystem,sftp]==${DLT_VERSION}" \
        psycopg2-binary \
        pymysql \
        pymssql \
        croniter \
        docker \
        cryptography

# Dépendances des sources verified (vendées au commit épinglé).
COPY --from=verified-sources /vendor/reqs/all.txt /tmp/verified-reqs.txt
COPY --from=verified-sources /vendor/repo/sources /app/vendor/sources
RUN pip install -r /tmp/verified-reqs.txt \
    && rm /tmp/verified-reqs.txt

COPY runner /app/runner

WORKDIR /app

# Auto-test minimal : les imports critiques et le registre des sources
# doivent être résolus au build (sinon l'image est inutilisable).
RUN python -c "import dlt; from dlt.sources.sql_database import sql_database; from runner import sources, destination, scheduler" \
    && python -m runner.main catalog > /tmp/catalog.json \
    && python -c "import json; entries = json.load(open('/tmp/catalog.json')); failed = [e for e in entries if e.get('error')]; print('sources importables :', len(entries) - len(failed), '/', len(entries)); [print('  ', e['key'], '->', e['error']) for e in failed]; assert len(entries) - len(failed) >= 40, failed"

CMD ["python", "-m", "runner.main", "run"]
