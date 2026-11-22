#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
umask 077
work=$(mktemp -d)
cleanup() {
  local result=$?
  if [[ -n "${vite_pid:-}" ]]; then kill "$vite_pid" 2>/dev/null || true; fi
  if [[ "$result" != 0 ]]; then tail -c 3000 "$work/vite.log"; fi
  rm -rf "$work"
}
trap cleanup EXIT
VITE_SUPABASE_URL=https://erp-local.invalid \
VITE_SUPABASE_PUBLISHABLE_KEY="$(node -p "require('/tmp/erp-test-runtime.json').PUBLISHABLE_KEY")" \
  node fabric-poc/node_modules/vite/bin/vite.js fabric-poc --host 127.0.0.1 --port 18768 --strictPort > "$work/vite.log" 2>&1 &
vite_pid=$!
for attempt in {1..30}; do
  if curl --silent --fail http://127.0.0.1:18768/fabric.html >/dev/null; then break; fi
  sleep 1
done
curl --silent --fail http://127.0.0.1:18768/fabric.html >/dev/null
node fabric-poc/integration/transferable-browser.mjs
