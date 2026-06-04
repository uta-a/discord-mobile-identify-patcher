#!/usr/bin/env bash
set -euo pipefail

branch="${1:-stable}"
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

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found in PATH. Install Node.js, then run this script again." >&2
  exit 1
fi

if [ ! -d "$repo_root/node_modules" ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm was not found in PATH. Install Node.js with npm, then run this script again." >&2
    exit 1
  fi

  npm install
fi

interactive_args=()
if [ "${DMI_NONINTERACTIVE:-0}" != "1" ]; then
  interactive_args+=(--interactive)
fi

node src/cli.mjs install --branch "$branch" --force-close "${interactive_args[@]}"
