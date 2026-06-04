#!/usr/bin/env bash
set -euo pipefail

branch="${1:-stable}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Required command %s was not found. Install it and run this script again.\n' "$1" >&2
    exit 1
  fi
}

discord_user_data_name() {
  case "$branch" in
    canary) printf 'discordcanary' ;;
    ptb) printf 'discordptb' ;;
    *) printf 'discord' ;;
  esac
}

log_file() {
  if [ -n "${DMI_LOG_DIR:-}" ]; then
    mkdir -p "$DMI_LOG_DIR"
    printf '%s/install.log' "$DMI_LOG_DIR"
    return
  fi

  local data_dir="$HOME/Library/Application Support/$(discord_user_data_name)/mobile-identify-patcher"
  mkdir -p "$data_dir"
  printf '%s/install.log' "$data_dir"
}

case "$branch" in
  stable|canary|ptb) ;;
  *)
    echo "Usage: $0 [stable|canary|ptb]" >&2
    exit 2
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
cd "$repo_root"

require_command node

if [ ! -d "$repo_root/node_modules" ]; then
  require_command npm

  {
    printf '{"timestamp":"%s","command":"npm install","event":"start"}\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    npm install
    printf '{"timestamp":"%s","command":"npm install","event":"success"}\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  } >>"$(log_file)" 2>&1
fi

node src/cli.mjs uninstall --branch "$branch" --force-close
