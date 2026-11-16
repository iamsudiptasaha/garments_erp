#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
runtime=${TEST_RUNTIME_FILE:-/tmp/erp-test-runtime.json}
log=$(mktemp)
cleanup() {
  local result=$?
  kill "$vite_pid" "$account_pid" 2>/dev/null || true
  if [[ "$result" != 0 ]]; then tail -c 4000 "$log"; fi
  rm -f "$log"
}
deno=(npx --yes deno@2.9.6)
if [[ -n "${DENO_BIN:-}" ]]; then deno=("$DENO_BIN"); fi
"${deno[@]}" run --frozen --config supabase/functions/erp-accounts/deno.json \
  --allow-env --allow-read="$runtime" --allow-net=127.0.0.1,localhost \
  scripts/ci/serve-accounts-local.ts "$runtime" >> "$log" 2>&1 &
account_pid=$!
VITE_SUPABASE_URL=https://erp-local.invalid \
VITE_SUPABASE_PUBLISHABLE_KEY="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1])).PUBLISHABLE_KEY)' "$runtime")" \
  node fabric-poc/node_modules/vite/bin/vite.js fabric-poc --host 127.0.0.1 --port 18687 --strictPort >> "$log" 2>&1 &
vite_pid=$!
trap cleanup EXIT
for attempt in {1..30}; do
  if curl --silent --fail http://127.0.0.1:18687/access.html >/dev/null; then break; fi
  if ! kill -0 "$vite_pid" 2>/dev/null; then exit 1; fi
  sleep 1
done
curl --silent --fail http://127.0.0.1:18687/access.html >/dev/null
for attempt in {1..30}; do
  if curl --silent --fail -X OPTIONS http://127.0.0.1:55425 >/dev/null; then break; fi
  if ! kill -0 "$account_pid" 2>/dev/null; then exit 1; fi
  sleep 1
done
curl --silent --fail -X OPTIONS http://127.0.0.1:55425 >/dev/null
TEST_RUNTIME_FILE="$runtime" node fabric-poc/integration/administration-browser.mjs
