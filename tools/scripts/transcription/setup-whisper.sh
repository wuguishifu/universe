#!/bin/sh
# Builds whisper-cli for this machine and downloads whisper models into bin/, for running the
# transcription worker (platform/transcription/worker) locally. bin/ is gitignored.
#
# Usage: tools/scripts/transcription/setup-whisper.sh [model...]   (default: base.en large-v3-turbo-q8_0)
#
# Models are named like WHISPER_MODELS (ggml-<model>.bin), e.g. small.en-q8_0. large-v3-turbo-q8_0
# is ~874MB, and is what the mini runs for the most accurate transcripts and word timings.
#
# Re-running rebuilds whisper-cli and skips models that are already downloaded.
set -eu

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BIN="$ROOT/bin"
# Production runs Homebrew's whisper.cpp on the mini (see its Brewfile in the homelab repo), so keep
# this in step with `brew list --versions whisper.cpp` there. WHISPER_CPP_VERSION overrides it.
VERSION="${WHISPER_CPP_VERSION:-v1.9.5}"
# The same Hugging Face commit the mini's models.txt checksums belong to (HF_REVISION in its
# service.env), so local models are the same files as production's.
HF_REVISION=5359861c739e955e79d9a303bcbc70fb988958b1
MODELS_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/$HF_REVISION"

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

[ "$#" -eq 0 ] && set -- base.en large-v3-turbo-q8_0
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

Done. Point the transcription worker at these in its .env:
  WHISPER_CLI_PATH=bin/whisper-cli
  WHISPER_MODELS_DIR=bin
  WHISPER_MODELS=$(echo "$@" | tr ' ' ',')
EOF
