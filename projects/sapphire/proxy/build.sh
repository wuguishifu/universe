#!/usr/bin/env bash
# Builds the gomobile bindings into the sapphire-mobile native module.
#   ./build.sh ios|android|all
set -euo pipefail

cd "$(dirname "$0")"
MODULE_DIR=../mobile/modules/sapphire-proxy
export PATH="$(go env GOPATH)/bin:$PATH"

if ! command -v gomobile >/dev/null; then
  go install golang.org/x/mobile/cmd/gomobile@latest
  gomobile init
fi

build_ios() {
  mkdir -p "$MODULE_DIR/ios/Frameworks"
  rm -rf "$MODULE_DIR/ios/Frameworks/Sapphireproxy.xcframework"
  gomobile bind -target=ios,iossimulator -iosversion=15.1 -ldflags="-s -w" \
    -o "$MODULE_DIR/ios/Frameworks/Sapphireproxy.xcframework" .
}

build_android() {
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
    ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$(ls "$ANDROID_HOME/ndk" | sort -V | tail -1)"
    export ANDROID_NDK_HOME
  fi
  mkdir -p "$MODULE_DIR/android/libs"
  gomobile bind -target=android/arm64,android/amd64 -androidapi 24 \
    -javapkg dev.wuguishifu.sapphire -ldflags="-s -w" \
    -o "$MODULE_DIR/android/libs/sapphireproxy.aar" .
  rm -f "$MODULE_DIR/android/libs/sapphireproxy-sources.jar"
}

case "${1:-all}" in
  ios) build_ios ;;
  android) build_android ;;
  all) build_ios && build_android ;;
  *) echo "usage: $0 ios|android|all" >&2 && exit 1 ;;
esac
