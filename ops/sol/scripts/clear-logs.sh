#!/bin/sh

ROOT_DIR="$(cd "$(dirname "$0")" || exit 1; pwd)"

docker compose \
  --env-file "$ROOT_DIR/../.env" \
  -f "$ROOT_DIR/../docker-compose.yml" \
  up -d --no-deps --force-recreate \
  osmium
