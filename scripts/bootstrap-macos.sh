#!/usr/bin/env bash
set -euo pipefail

branch="${1:-${DMI_BRANCH:-}}"
ref="${DMI_REF:-main}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Required command %s was not found. Install it and run this script again.\n' "$1" >&2
    exit 1
  fi
}

download() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$url"
  else
    printf 'Required command curl or wget was not found.\n' >&2
    exit 1
  fi
}

if [ -n "$branch" ]; then
  case "$branch" in
    stable|canary|ptb) ;;
    *)
    echo "Usage: $0 [stable|canary|ptb]" >&2
    exit 2
    ;;
  esac
fi

require_command node
require_command npm

temp_root="$(mktemp -d "${TMPDIR:-/tmp}/discord-mobile-identify-patcher.XXXXXX")"
cleanup() {
  rm -rf "$temp_root"
}
trap cleanup EXIT

archive_path="$temp_root/source.tar.gz"
extract_path="$temp_root/source"
archive_url="https://github.com/uta-a/discord-mobile-identify-patcher/archive/refs/heads/$ref.tar.gz"

mkdir -p "$extract_path"
download "$archive_url" > "$archive_path"

tar -xzf "$archive_path" -C "$extract_path"

repo_root="$(find "$extract_path" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [ -z "$repo_root" ]; then
  echo "Downloaded archive did not contain a project directory." >&2
  exit 1
fi

if [ -n "$branch" ]; then
  bash "$repo_root/scripts/install-macos.sh" "$branch"
else
  bash "$repo_root/scripts/install-macos.sh"
fi
