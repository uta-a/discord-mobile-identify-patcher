#!/usr/bin/env bash
set -euo pipefail

branch="${1:-${DMI_BRANCH:-stable}}"
ref="${DMI_REF:-main}"
install_mode="${DMI_INSTALL_MODE:-auto}"

case "$branch" in
  stable|canary|ptb) ;;
  *)
    echo "Usage: $0 [stable|canary|ptb]" >&2
    exit 2
    ;;
esac

case "$install_mode" in
  auto|preserve-existing|direct-discord) ;;
  *)
    echo "DMI_INSTALL_MODE must be auto, preserve-existing, or direct-discord" >&2
    exit 2
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found in PATH. Install Node.js, then run this script again." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found in PATH. Install Node.js with npm, then run this script again." >&2
  exit 1
fi

temp_root="$(mktemp -d "${TMPDIR:-/tmp}/discord-mobile-identify-patcher.XXXXXX")"
cleanup() {
  rm -rf "$temp_root"
}
trap cleanup EXIT

archive_path="$temp_root/source.tar.gz"
extract_path="$temp_root/source"
archive_url="https://github.com/uta-a/discord-mobile-identify-patcher/archive/refs/heads/$ref.tar.gz"

mkdir -p "$extract_path"
curl -fsSL "$archive_url" -o "$archive_path"
tar -xzf "$archive_path" -C "$extract_path"

repo_root="$(find "$extract_path" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [ -z "$repo_root" ]; then
  echo "Downloaded archive did not contain a project directory." >&2
  exit 1
fi

DMI_INSTALL_MODE="$install_mode" bash "$repo_root/scripts/install-macos.sh" "$branch"
