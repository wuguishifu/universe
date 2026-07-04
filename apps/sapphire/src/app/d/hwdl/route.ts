import { NextResponse } from 'next/server';

export function GET() {
  return new NextResponse(`#!/bin/sh
# Installs the homework-downloader CLI (hwdl).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/wuguishifu/homework-downloader/main/install.sh | sh
#
# Env vars:
#   HWDL_VERSION      release tag to install (default: latest)
#   HWDL_INSTALL_DIR  install directory (default: $HOME/.homework-downloader/bin)

set -e

REPO="wuguishifu/homework-downloader"
BIN_NAME="hwdl"
INSTALL_DIR="\${HWDL_INSTALL_DIR:-$HOME/.homework-downloader/bin}"
VERSION="\${HWDL_VERSION:-latest}"

detect_platform() {
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin) platform="macos" ;;
    Linux) platform="linux" ;;
    *)
      echo "Error: unsupported OS: $os" >&2
      echo "hwdl currently only supports macOS and Linux." >&2
      exit 1
      ;;
  esac

  case "$arch" in
    x86_64 | amd64) arch="x64" ;;
    arm64 | aarch64) arch="arm64" ;;
    *)
      echo "Error: unsupported architecture: $arch" >&2
      exit 1
      ;;
  esac

  asset="homework-downloader-\${platform}-\${arch}"
}

download_url() {
  if [ "$VERSION" = "latest" ]; then
    echo "https://github.com/\${REPO}/releases/latest/download/\${asset}"
  else
    echo "https://github.com/\${REPO}/releases/download/\${VERSION}/\${asset}"
  fi
}

add_to_path() {
  case ":$PATH:" in
    *":$INSTALL_DIR:"*)
      echo "$INSTALL_DIR is already in your PATH."
      return
      ;;
  esac

  shell_name="$(basename "\${SHELL:-sh}")"

  case "$shell_name" in
    fish)
      profile="$HOME/.config/fish/config.fish"
      line="set -gx PATH \\"$INSTALL_DIR\\" \\$PATH"
      ;;
    zsh)
      profile="$HOME/.zshrc"
      line="export PATH=\\"$INSTALL_DIR:\\$PATH\\""
      ;;
    bash)
      if [ "$(uname -s)" = "Darwin" ]; then
        profile="$HOME/.bash_profile"
      else
        profile="$HOME/.bashrc"
      fi
      line="export PATH=\\"$INSTALL_DIR:\\$PATH\\""
      ;;
    *)
      profile="$HOME/.profile"
      line="export PATH=\\"$INSTALL_DIR:\\$PATH\\""
      ;;
  esac

  mkdir -p "$(dirname "$profile")"
  touch "$profile"

  if grep -qs "$INSTALL_DIR" "$profile"; then
    echo "PATH entry already present in $profile"
  else
    printf '\n# Added by homework-downloader installer\n%s\n' "$line" >>"$profile"
    echo "Added $INSTALL_DIR to PATH in $profile"
  fi

  echo ""
  echo "Restart your shell, or run:"
  echo "  source $profile"
  echo "then run '$BIN_NAME' to get started."
}

main() {
  detect_platform
  url="$(download_url)"

  echo "Installing hwdl (homework-downloader) for \${platform}-\${arch}..."
  echo "Downloading \${url}"

  mkdir -p "$INSTALL_DIR"
  tmp_file="$(mktemp)"

  if ! curl -fsSL "$url" -o "$tmp_file"; then
    echo "Error: failed to download binary from $url" >&2
    rm -f "$tmp_file"
    exit 1
  fi

  chmod +x "$tmp_file"
  mv "$tmp_file" "$INSTALL_DIR/$BIN_NAME"

  echo "Installed $BIN_NAME to $INSTALL_DIR/$BIN_NAME"

  add_to_path
}

main`);
}
