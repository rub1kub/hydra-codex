#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8787}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

node "$SKILL_DIR/scripts/mail_ui_server.js" --host "$HOST" --port "$PORT"
