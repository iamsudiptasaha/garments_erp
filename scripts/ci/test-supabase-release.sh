#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55422/postgres'
node scripts/ci/assert-test-db.mjs

container=supabase_db_garments-erp-ci
database="cli_release_$$"
db_url="${TEST_DATABASE_URL%/*}/$database?sslmode=disable"
project=$(mktemp -d)
docker exec "$container" createdb -U postgres "$database"
cleanup() {
  docker exec "$container" dropdb -U postgres "$database"
  rm -rf "$project"
}
trap cleanup EXIT

query() { docker exec -i "$container" psql -XAt -v ON_ERROR_STOP=1 -U postgres -d "$database" "$@"; }
cli() { npx --yes supabase@2.122.0 "$@" --workdir "$project" --db-url "$db_url"; }

mkdir -p "$project/supabase/migrations"
cp supabase/migrations/*.sql "$project/supabase/migrations/"
# Simulate the production ledger in a fresh, disposable database. If the CLI
# replays any historical file, the no-op check fails against this empty schema.
{
  echo 'create schema supabase_migrations;'
  echo 'create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);'
  for file in "$project"/supabase/migrations/*.sql; do
    filename=${file##*/}
    version=${filename%%_*}
    [[ "$version" =~ ^[0-9]{14}$ ]]
    printf "insert into supabase_migrations.schema_migrations(version) values ('%s');\n" "$version"
  done
} | query >/dev/null
cli migration list >"$project/history.log" || { tail -c 3500 "$project/history.log"; exit 1; }
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {hasCutoverHistory} from "./scripts/ci/migrate-production.mjs"; if (!hasCutoverHistory(readFileSync(process.argv[1], "utf8"))) process.exit(1)' "$project/history.log"
cli db push --yes

first=20990101000001
second=20990101000002
third=20990101000003
printf 'begin; create table public.release_fixture(id integer primary key); commit;\n' >"$project/supabase/migrations/${first}_first.sql"
printf "begin; insert into public.release_fixture values (2); select current_setting('erp_release.intentional_failure'); commit;\n" >"$project/supabase/migrations/${second}_second.sql"
printf 'begin; insert into public.release_fixture values (3); commit;\n' >"$project/supabase/migrations/${third}_third.sql"
if cli db push --yes >"$project/failure.log" 2>&1; then
  echo 'Expected the second migration to fail.' >&2
  exit 1
fi
if ! grep -q 'erp_release.intentional_failure' "$project/failure.log"; then
  tail -c 3500 "$project/failure.log" >&2
  exit 1
fi
[[ "$(query -c "select string_agg(version, ',') from supabase_migrations.schema_migrations where version >= '$first'")" == "$first" ]]
[[ "$(query -c 'select count(*) from public.release_fixture')" == 0 ]]
printf 'begin; insert into public.release_fixture values (2); commit;\n' >"$project/supabase/migrations/${second}_second.sql"
cli db push --yes
cli db push --yes
[[ "$(query -c "select string_agg(id::text, ',' order by id) from public.release_fixture")" == '2,3' ]]
[[ "$(query -c "select count(*) from supabase_migrations.schema_migrations where version >= '$first'")" == 3 ]]
echo 'PASS native Supabase history, sequential stop on failure, failed-file rollback, and retry'
