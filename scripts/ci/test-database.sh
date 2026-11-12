#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55422/postgres'
node scripts/ci/assert-test-db.mjs
container=supabase_db_garments-erp-ci
# Fixed container name and no remote flags. Production URLs/keys are never accepted.
node database/ci/seed.mjs /tmp/erp-ci-seed.sql
docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < database/ci/baseline.sql >/tmp/erp-ci-baseline.log
for migration in supabase/migrations/*.sql; do
  version=$(basename "$migration" | cut -d_ -f1)
  if [[ "$version" > 20261029201541 ]]; then
    if [[ "$version" == 20261108090000 ]]; then
      while IFS= read -r line; do
        if [[ "$line" == '\ir ../../supabase/migrations/20261108090000_sellable_product.sql' ]]; then
          cat "$migration"
        else
          printf '%s\n' "$line"
        fi
      done < database/tests/sellable-product-backfill.sql |
        docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/tmp/erp-ci-migration.log
    else
      docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$migration" >/tmp/erp-ci-migration.log
    fi
  fi
done
docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /tmp/erp-ci-seed.sql >/tmp/erp-ci-seed.log
node fabric-poc/integration/database-check.mjs
node fabric-poc/integration/account-security.mjs
node fabric-poc/integration/employee-security.mjs
node fabric-poc/integration/contact-primary.mjs
# Existing contracts run in the isolated database only.
for sql in database/tests/access-schema-boundary.sql database/tests/grid-preferences.sql database/tests/raw-material-transactions.sql database/tests/dyed-bill-verification.sql database/tests/production-hub-and-review-ownership.sql database/tests/production-atomic-handover.sql database/tests/item-batch-number.sql database/tests/finished-products.sql database/tests/billing-packing-dispatch.sql database/tests/production-workspace.sql database/tests/lab-dip-status-items.sql database/tests/contact-primary.sql database/tests/fabric-reference-contract.sql database/tests/live-fabric-access.sql database/tests/fabric-validation-scope.sql database/tests/private-file-storage.sql database/tests/bucket-lifecycle.sql database/tests/file-upload-routes.sql database/tests/reviewed-attachments.sql; do
  { echo "select set_config('request.jwt.claims','{\"aal\":\"aal2\",\"amr\":[{\"method\":\"password\"}],\"session_id\":\"10000000-0000-4000-8000-000000000001\"}',false);"; cat "$sql"; } | docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/tmp/erp-ci-contract.log
done
{ sed '/^\\ir challan-fixture.sql$/r database/tests/challan-fixture.sql' database/tests/challan-documents.sql | sed '/^\\ir challan-fixture.sql$/d'; } |
  docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/tmp/erp-ci-challan.log
node fabric-poc/integration/production-security.mjs
bash scripts/ci/test-production-migration.sh
# Restore rehearsal for a synthetic application backup; never downloads production backups.
docker exec "$container" pg_dump -U postgres -d postgres -Fc -n auth -n storage -n garments_erp -n garments_access > /tmp/erp-ci-backup.dump
docker exec "$container" createdb -U postgres --template=template0 erp_ci_restore
docker exec "$container" psql -U postgres -d erp_ci_restore -v ON_ERROR_STOP=1 -c 'create schema extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions;' >/tmp/erp-ci-restore-reset.log 2>&1
docker exec -i "$container" pg_restore -U supabase_admin -d erp_ci_restore --no-owner --exit-on-error < /tmp/erp-ci-backup.dump >/tmp/erp-ci-restore.log 2>&1
docker exec "$container" psql -U postgres -d erp_ci_restore -v ON_ERROR_STOP=1 -c "do \$\$ begin if (select count(*) from garments_access.app_user)<>2 then raise exception 'Synthetic restore count mismatch';end if;end \$\$;" >/tmp/erp-ci-restore-check.log
echo 'PASS isolated schema replay, security/transactions/concurrency, and synthetic backup restore'
