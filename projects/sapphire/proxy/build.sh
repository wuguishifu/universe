#!/usr/bin/env bash
# Builds the gomobile bindings into this package's native module dirs.
#   ./build.sh ios|android|all
set -euo pipefail

cd "$(dirname "$0")"

# EAS build images don't ship Go, so fetch the version go.mod asks for.
if ! command -v go >/dev/null && [[ -n "${EAS_BUILD:-}" ]]; then
  GO_VERSION="$(awk '/^go /{print $2}' go.mod)"
  GO_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$(uname -m)" in
    arm64 | aarch64) GO_ARCH=arm64 ;;
    *) GO_ARCH=amd64 ;;
  esac
  GO_ROOT="$HOME/.cache/sapphire-proxy/go$GO_VERSION"
  if [[ ! -x "$GO_ROOT/bin/go" ]]; then
    mkdir -p "$GO_ROOT"
    curl -fsSL "https://go.dev/dl/go$GO_VERSION.$GO_OS-$GO_ARCH.tar.gz" |
      tar -xz -C "$GO_ROOT" --strip-components=1
  fi
  export PATH="$GO_ROOT/bin:$PATH"
fi

export PATH="$(go env GOPATH)/bin:$PATH"

if ! command -v gomobile >/dev/null; then
  go install golang.org/x/mobile/cmd/gomobile@latest
  gomobile init
fi

build_ios() {
  mkdir -p "ios/Frameworks"
  rm -rf "ios/Frameworks/Sapphireproxy.xcframework"
  gomobile bind -target=ios,iossimulator -iosversion=15.1 -ldflags="-s -w" \
    -o "ios/Frameworks/Sapphireproxy.xcframework" .
}

build_android() {
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
    ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$(ls "$ANDROID_HOME/ndk" | sort -V | tail -1)"
    export ANDROID_NDK_HOME
  fi
  mkdir -p "android/libs"
  gomobile bind -target=android/arm64,android/amd64 -androidapi 24 \
    -javapkg dev.wuguishifu.sapphire -ldflags="-s -w" \
    -o "android/libs/sapphireproxy.aar" .
  rm -f "android/libs/sapphireproxy-sources.jar"
}

case "${1:-all}" in
  ios) build_ios ;;
  android) build_android ;;
  all) build_ios && build_android ;;
  *) echo "usage: $0 ios|android|all" >&2 && exit 1 ;;
esac
