#!/usr/bin/env bash
set -euo pipefail

DB_EXISTS=$(docker exec -i hydrogen-db psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='redash'")
if [ "$DB_EXISTS" != "1" ]; then
  docker exec -i hydrogen-db psql -U postgres -c "CREATE DATABASE redash;"
fi

docker compose run --rm redash-server create_db

