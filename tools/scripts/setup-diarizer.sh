#!/bin/sh
# Installs the speaker diarizer (platform/transcription/diarizer) and pyannote's model into bin/, for
# running the transcription worker's `diarize` option locally. bin/ is gitignored.
#
# Usage: tools/scripts/setup-diarizer.sh
#
# Needs uv (`brew install uv`), which brings its own Python, so the system's Python doesn't matter.
# The model is gated: accept its terms on https://huggingface.co/pyannote/speaker-diarization-community-1
# with your Hugging Face account, then either set HF_TOKEN or log in with
# `bin/diarizer-venv/bin/hf auth login` (this script installs it) and re-run.
#
# The diarizer is installed editable, so changes to its source apply without re-running this. Re-run
# it when its dependencies (uv.lock) change. The model is skipped once it's at REVISION.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BIN="$ROOT/bin"
VENV="$BIN/diarizer-venv"
MODEL_DIR="$BIN/speaker-diarization-community-1"
# The same commit the mini downloads (PYANNOTE_REVISION in the homelab repo's
# hosts/mini/services/transcription-worker/service.env), so local diarization matches production's.
REVISION=3533c8cf8e369892e6b79ff1bf80f7b0286a54ee

if ! command -v uv > /dev/null; then
  echo "uv is required (brew install uv)"
  exit 1
fi

mkdir -p "$BIN"

echo "Installing the diarizer into $VENV"
UV_PROJECT_ENVIRONMENT="$VENV" uv sync --project "$ROOT/platform/transcription/diarizer" \
  --frozen --no-dev --compile-bytecode --quiet
# The first import after an install takes ~30s on macOS (it checks the new native libraries), so get
# it out of the way here rather than in the first job.
"$VENV/bin/python" -c 'import torch, pyannote.audio' 2> /dev/null

if [ "$(cat "$MODEL_DIR/.revision" 2> /dev/null)" = "$REVISION" ]; then
  echo "$MODEL_DIR is already at $REVISION"
else
  echo "Downloading pyannote/speaker-diarization-community-1"
  # Download to a temporary name so an interrupted download never looks like a model.
  rm -rf "$MODEL_DIR.partial"
  if ! "$VENV/bin/hf" download pyannote/speaker-diarization-community-1 \
    --revision "$REVISION" --local-dir "$MODEL_DIR.partial" --quiet > /dev/null; then
    cat >&2 << EOF

Couldn't download the model. It's gated, so this needs a Hugging Face account that has accepted its
terms on https://huggingface.co/pyannote/speaker-diarization-community-1, and either HF_TOKEN set or
a login from:
  bin/diarizer-venv/bin/hf auth login
EOF
    exit 1
  fi
  echo "$REVISION" > "$MODEL_DIR.partial/.revision"
  rm -rf "$MODEL_DIR"
  mv "$MODEL_DIR.partial" "$MODEL_DIR"
fi

cat << EOF

Done. Point the transcription worker at these in its .env:
  DIARIZER_PATH=bin/diarizer-venv/bin/diarize
  DIARIZER_MODEL_DIR=bin/speaker-diarization-community-1
EOF
