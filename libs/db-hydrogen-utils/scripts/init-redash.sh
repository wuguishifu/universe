#!/usr/bin/env bash
set -euo pipefail

# Create DB if missing
docker exec -i hydrogen-db psql -U postgres <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'redash') THEN
    CREATE DATABASE redash;
  END IF;
END $$;
SQL

# Run Redash migrations / bootstrap
docker compose run --rm redash-server create_db
