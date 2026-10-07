#!/bin/sh
# Builds whisper-cli for this machine and downloads whisper models into bin/, for running
# transcription-worker locally (see platform/transcription/worker/README.md). bin/ is gitignored.
#
# Usage: tools/scripts/setup-whisper.sh [model...]   (default: base.en)
#
# The whisper.cpp version comes from transcription-worker's Dockerfile, so local runs match the image.
# Re-running rebuilds whisper-cli and skips models that are already downloaded.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BIN="$ROOT/bin"
DOCKERFILE="$ROOT/platform/transcription/service/Dockerfile"
MODELS_URL=https://huggingface.co/ggerganov/whisper.cpp/resolve/main

VERSION=$(sed -n 's/^ARG WHISPER_CPP_VERSION=//p' "$DOCKERFILE")
if [ -z "$VERSION" ]; then
  echo "Couldn't read WHISPER_CPP_VERSION from $DOCKERFILE"
  exit 1
fi

for tool in cmake git curl; do
  if ! command -v "$tool" > /dev/null; then
    echo "$tool is required"
    exit 1
  fi
done

mkdir -p "$BIN"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "Building whisper-cli $VERSION"
git clone --quiet --depth 1 --branch "$VERSION" https://github.com/ggml-org/whisper.cpp.git "$WORK/whisper.cpp"
# Static, so bin/whisper-cli runs on its own. On macOS, Metal is on by default and its shaders are
# embedded in the binary.
cmake -S "$WORK/whisper.cpp" -B "$WORK/whisper.cpp/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_SERVER=OFF \
  > /dev/null
cmake --build "$WORK/whisper.cpp/build" --config Release --target whisper-cli -j > /dev/null
cp "$WORK/whisper.cpp/build/bin/whisper-cli" "$BIN/whisper-cli"
echo "Wrote $BIN/whisper-cli"

[ "$#" -eq 0 ] && set -- base.en
for model in "$@"; do
  file="$BIN/ggml-$model.bin"
  if [ -f "$file" ]; then
    echo "$file already exists; delete it to download again"
    continue
  fi
  echo "Downloading ggml-$model.bin"
  # Download to a temporary name so an interrupted download never looks like a model.
  curl --fail --location --progress-bar "$MODELS_URL/ggml-$model.bin" --output "$file.partial"
  mv "$file.partial" "$file"
done

cat << EOF

Done. Point transcription-worker at these in the root .env:
  WHISPER_CLI_PATH=bin/whisper-cli
  WHISPER_MODELS_DIR=bin
  WHISPER_MODELS=$(echo "$@" | tr ' ' ',')
EOF
