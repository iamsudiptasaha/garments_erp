#!/usr/bin/env bash
# Populated replay of the reviewed migration. Fixed local container/database only.
set -euo pipefail
cd "$(dirname "$0")/../.."
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55422/postgres'
node scripts/ci/assert-test-db.mjs
container=supabase_db_garments-erp-ci
database=erp_ci_production_migration
migration=supabase/migrations/20261105135706_production_hub_and_review_ownership.sql
work=$(mktemp -d)
cleanup() {
  result=$?
  if [[ "$result" != 0 && -f "$work/replay.log" ]]; then tail -c 8000 "$work/replay.log"; fi
  docker exec "$container" dropdb -U postgres --if-exists "$database" >/dev/null 2>&1 || true
  rm -rf "$work"
  exit "$result"
}
trap cleanup EXIT
# ERP Auth triggers depend on application functions installed by the migration replay.
docker exec "$container" pg_dump -U postgres -d postgres --schema-only -n auth -n storage -n extensions |
  awk '!(/^CREATE TRIGGER / && / ON auth.users / && /EXECUTE FUNCTION garments_access[.]/)' > "$work/auth.sql"
docker exec "$container" createdb -U postgres "$database"
created_database=true
docker exec "$container" dropdb -U postgres --if-exists "$database" > "$work/replay.log" 2>&1
docker exec "$container" createdb -U postgres "$database" >> "$work/replay.log" 2>&1
docker exec -i "$container" psql -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 < "$work/auth.sql" >> "$work/replay.log" 2>&1
docker exec "$container" psql -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -c 'create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions;' >> "$work/replay.log" 2>&1
docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 < database/ci/baseline.sql >> "$work/replay.log" 2>&1
for prior in supabase/migrations/*.sql; do
  version=$(basename "$prior" | cut -d_ -f1)
  if [[ "$version" > 20261029201439 && "$version" < 20261105135706 ]]; then
    docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 < "$prior" >> "$work/replay.log" 2>&1
  fi
done
node database/ci/seed.mjs "$work/seed.sql" --before-erp-schema-move
for sql in "$work/seed.sql" database/tests/production-hub-backfill-before.sql "$migration" database/tests/production-hub-backfill-after.sql database/tests/employee-photo-backfill-before.sql supabase/migrations/20261105152128_employee_photo_attachment_and_checklist.sql database/tests/employee-photo-attachment.sql; do
  docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 < "$sql" >> "$work/replay.log" 2>&1
done
echo 'PASS populated production, assignee, Lab Dip, receipt and employee-photo migration backfill'
