#!/usr/bin/env bash
set -euo pipefail

POSTGRES_USER="${POSTGRES_USER:-}"
if [ -z "$POSTGRES_USER" ] && [ -f .env ]; then
  POSTGRES_USER=$(grep -E '^[[:space:]]*POSTGRES_USER=' .env | tail -n 1 | sed -E 's/^[[:space:]]*POSTGRES_USER=//')
fi
POSTGRES_USER="${POSTGRES_USER:-postgres}"
DB_EXISTS=$(docker exec -i hydrogen-db psql -U "$POSTGRES_USER" -tAc "SELECT 1 FROM pg_database WHERE datname='redash'")
if [ "$DB_EXISTS" != "1" ]; then
  docker exec -i hydrogen-db psql -U "$POSTGRES_USER" -c "CREATE DATABASE redash;"
fi

docker compose run --rm redash-server create_db
