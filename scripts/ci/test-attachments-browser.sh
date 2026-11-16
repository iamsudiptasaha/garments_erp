#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
umask 077
work=$(mktemp -d)
cleanup() {
  local result=$?
  if [[ -n "${files_pid:-}" ]]; then kill "$files_pid" 2>/dev/null || true; fi
  if [[ -n "${vite_pid:-}" ]]; then kill "$vite_pid" 2>/dev/null || true; fi
  if [[ "$result" != 0 ]]; then tail -c 3000 "$work"/*.log; fi
  rm -rf "$work"
}
trap cleanup EXIT
query() {
  docker exec -i supabase_db_garments-erp-ci psql -U postgres -d postgres -v ON_ERROR_STOP=1
}
{
  echo 'begin;'
  cat database/tests/attachment-browser-fixture.sql database/tests/challan-fixture.sql database/tests/attachment-browser-workflow-fixture.sql
  echo 'commit;'
} | query > "$work/seed.log" 2>&1
npx --yes deno@2.9.6 run --no-lock --allow-env --allow-read=/tmp/erp-test-runtime.json \
  --allow-net=127.0.0.1,localhost scripts/ci/serve-files-local.ts > "$work/files.log" 2>&1 &
files_pid=$!
VITE_SUPABASE_URL=https://erp-local.invalid \
VITE_SUPABASE_PUBLISHABLE_KEY="$(node -p "require('/tmp/erp-test-runtime.json').PUBLISHABLE_KEY")" \
  node fabric-poc/node_modules/vite/bin/vite.js fabric-poc --host 127.0.0.1 --port 18766 --strictPort > "$work/vite.log" 2>&1 &
vite_pid=$!
for attempt in {1..30}; do
  if curl --silent --fail -X OPTIONS http://127.0.0.1:55426/ >/dev/null &&
     curl --silent --fail http://127.0.0.1:18766/fabric.html >/dev/null; then break; fi
  sleep 1
done
curl --silent --fail -X OPTIONS http://127.0.0.1:55426/ >/dev/null
curl --silent --fail http://127.0.0.1:18766/fabric.html >/dev/null
ATTACHMENT_FILES_SERVICE=http://127.0.0.1:55426 node fabric-poc/integration/attachment-browser.mjs
ATTACHMENT_FILES_SERVICE=http://127.0.0.1:55426 node fabric-poc/integration/attachment-browser.mjs --owning-modal
ATTACHMENT_FILES_SERVICE=http://127.0.0.1:55426 node fabric-poc/integration/attachment-browser.mjs --fabric-planner
