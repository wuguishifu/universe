#!/usr/bin/env bash
set -euo pipefail
docker compose run --rm redash-server create_db
