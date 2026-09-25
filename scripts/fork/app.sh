#!/usr/bin/env bash
# Run or build the fork via upstream's frontend/dev-gpu.sh / build-gpu.sh,
# which build the llama-helper sidecar and pick GPU features first.
# Fork-only settings (no signed updater artifacts; updates from this fork's
# releases, never upstream's) live in frontend/src-tauri/tauri.<platform>.conf.json,
# which Tauri merges into tauri.conf.json automatically.
#
#   scripts/fork/app.sh dev      run in development mode
#   scripts/fork/app.sh build    installable build (.dmg / .msi / .deb)
set -euo pipefail
MODE="${1:-dev}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"


cd "$ROOT/frontend"
case "$MODE" in
  dev)   exec ./dev-gpu.sh ;;
  build) exec ./build-gpu.sh ;;
  *) echo "usage: scripts/fork/app.sh dev|build"; exit 1 ;;
esac
