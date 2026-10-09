#!/bin/sh
# loads tools/mcp/.env.local (written by `nx setup environment`) and execs the given mcp server
set -e

DIR=$(cd "$(dirname "$0")" && pwd)

if [ ! -f "$DIR/.env.local" ]; then
  echo "tools/mcp/.env.local missing, run \`nx setup environment\`" >&2
  exit 1
fi

set -a
. "$DIR/.env.local"
set +a

exec "$@"
