#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
container=supabase_db_garments-erp-ci
migration=supabase/migrations/20261123200917_lab_dip_edition_groups.sql
database=erp_ci_edition_backfill
work=$(mktemp -d)
cleanup() {
 result=$?
 if [[ "$result" != 0 ]]; then tail -c 5000 "$work/replay.log"; fi
 docker exec "$container" dropdb -U postgres --if-exists "$database" >/dev/null 2>&1 || true
 rm -rf "$work"
 exit "$result"
}
trap cleanup EXIT
docker exec "$container" pg_dump -U postgres -d postgres --schema-only -n auth -n storage -n extensions |
 awk '!(/^CREATE TRIGGER / && / ON auth.users / && /EXECUTE FUNCTION garments_(access|erp)[.]/)' > "$work/auth.sql"
docker exec "$container" createdb -U postgres "$database"
docker exec -i "$container" psql -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 < "$work/auth.sql" > "$work/replay.log" 2>&1
docker exec "$container" psql -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -c 'create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions;' >> "$work/replay.log" 2>&1
docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 < database/ci/baseline.sql >> "$work/replay.log" 2>&1
for prior in supabase/migrations/*.sql; do
 version=$(basename "$prior" | cut -d_ -f1)
 if [[ "$version" > 20261029201541 && "$version" < 20261123200917 ]]; then
  docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 < "$prior" >> "$work/replay.log" 2>&1
 fi
done
docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 < database/tests/dyeing-edition-backfill-before.sql >/tmp/erp-edition-backfill.log
if docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 < "$migration" >/tmp/erp-edition-conflict.log 2>&1; then
  echo 'FAIL: conflicting backfill was accepted' >&2
  exit 1
fi
# Inspect the specific failure, rollback and retained original identities, not merely any error.
grep -q 'conflicting versions or batches' /tmp/erp-edition-conflict.log
docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 <<'SQL' >/tmp/erp-edition-conflict-check.log
do $$ declare f jsonb;begin
 select data into strict f from public.ci_edition_backfill_fixture;
 if to_regclass('garments_erp.dyeing_program_lab_dip') is not null or
  not exists(select 1 from garments_erp.dyeing_program_item where id=(f->>'first')::bigint and lab_dip_version_id=(f->>'v1')::bigint) or
  not exists(select 1 from garments_erp.dyeing_program_item where id=(f->>'second')::bigint and lab_dip_version_id=(f->>'v2')::bigint)
 then raise exception 'TEST conflicting migration did not roll back safely';end if;
 -- Explicit fixture reconciliation; production conflicts require operator review.
 update garments_erp.dyeing_program_item set lab_dip_version_id=(f->>'v1')::bigint where id=(f->>'second')::bigint;
end $$;
SQL
docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 < "$migration" >/tmp/erp-edition-migration.log
docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 < database/tests/dyeing-edition-backfill-after.sql >/tmp/erp-edition-backfill-after.log
echo 'PASS conflicting legacy migration rollback and populated identity-preserving backfill'
