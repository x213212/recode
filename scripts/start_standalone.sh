#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"

cd "$PROJECT_ROOT"

NODE_BIN="${NODE_BIN:-node}"
if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "Node.js was not found. Set NODE_BIN to a valid Node.js executable." >&2
  exit 127
fi

if [[ -n "${NEXT_DIST_DIR:-}" ]]; then
  DIST_DIR="$NEXT_DIST_DIR"
elif [[ -f ".next-linux/standalone/server.js" ]]; then
  DIST_DIR=".next-linux"
else
  DIST_DIR=".next"
fi

if [[ ! -f "$DIST_DIR/standalone/server.js" ]]; then
  echo "Standalone build not found: $DIST_DIR/standalone/server.js" >&2
  exit 1
fi

env \
  NEXT_DIST_DIR="$DIST_DIR" \
  RECODE_PROJECT_ROOT="$PROJECT_ROOT" \
  RECODE_PUBLIC_DIR="public" \
  "$NODE_BIN" scripts/prepare_standalone.mjs

export NODE_ENV=production
export HOSTNAME="${RECODE_HOSTNAME:-127.0.0.1}"
export PORT="${PORT:-3000}"
export RECODE_PROJECT_ROOT="${RECODE_PROJECT_ROOT:-$PROJECT_ROOT}"
export NEXT_TELEMETRY_DISABLED="${NEXT_TELEMETRY_DISABLED:-1}"

exec "$NODE_BIN" "$DIST_DIR/standalone/server.js"
