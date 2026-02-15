#!/usr/bin/env bash
set -euo pipefail

# Get Codex usage limits via browser CDP
# Usage: ./get_codex_usage.sh [--json] [--quiet] [--start-browser]
#
# Requires: running Chrome with CDP on port 18800
# If --start-browser is passed, will start openclaw browser first
#
# Output: JSON with remaining percentages and reset times

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
JSON_ONLY=false
QUIET=false
START_BROWSER=false

for arg in "$@"; do
  case "$arg" in
    --json|-j) JSON_ONLY=true ;;
    --quiet|-q) QUIET=true ;;
    --start-browser|-s) START_BROWSER=true ;;
  esac
done

log() { $QUIET || echo "[codex-usage] $*" >&2; }

# Ensure browser is running
if ! curl -sf http://127.0.0.1:18800/json >/dev/null 2>&1; then
  if $START_BROWSER; then
    log "Starting browser..."
    openclaw browser start >/dev/null 2>&1 || true
    sleep 3
  else
    echo '{"ok":false,"error":"Chrome not running. Use --start-browser or start manually."}' 
    exit 1
  fi
fi

# Run the Node.js extractor
ARGS=""
$JSON_ONLY && ARGS="$ARGS --json"
$QUIET && ARGS="$ARGS --quiet"

cd "$SKILL_DIR"
exec node scripts/get_codex_usage.js $ARGS
