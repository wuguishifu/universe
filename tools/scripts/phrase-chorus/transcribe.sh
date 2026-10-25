#!/usr/bin/env bash
# usage: transcribe.sh <phrase-dir>   — runs whisper (with DTW token timestamps) on <dir>/wav/*.wav into <dir>/jdtw/*.json
set -euo pipefail
DIR=$1; B="$(cd "$(dirname "$0")/../../../bin" && pwd)"
mkdir -p "$DIR/jdtw"
for f in "$DIR"/wav/*.wav; do
  n=$(basename "$f" .wav)
  # -nfa: DTW timestamps come back as -1 with flash attention on
  "$B/whisper-cli" -m "$B/ggml-large-v3-turbo-q8_0.bin" --dtw large.v3.turbo -nfa -l en -ojf -np \
    -f "$f" -of "$DIR/jdtw/$n" >/dev/null 2>&1 || echo "FAIL $n"
done
