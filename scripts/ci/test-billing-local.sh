#!/usr/bin/env bash
set -euo pipefail
# Run from the repository root with the dedicated garments-erp-ci Supabase
# stack running. The temporary database and API are separate from that stack's
# main database and all HTTP requests target loopback.
cd "$(dirname "$0")/../.."
container=supabase_db_garments-erp-ci
database="billing_review_$$_$(openssl rand -hex 4)"
created_database=false
work=$(mktemp -d)
cleanup() {
  result=$?
  if [[ -n "${auth_id:-}" ]]; then docker rm -f "$auth_id" >/dev/null 2>&1 || true; fi
  if [[ -n "${rest_id:-}" ]]; then docker stop "$rest_id" >/dev/null 2>&1 || true; fi
  if [[ "$result" != 0 ]]; then tail -c 4800 "$work/replay.log"; fi
  if [[ "$created_database" == true ]]; then
    docker exec "$container" dropdb -U postgres --if-exists "$database" >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
  exit "$result"
}
trap cleanup EXIT
exec 3>"$work/replay.log"
docker exec "$container" pg_dump -U postgres -d postgres --schema-only -n auth -n storage -n extensions > "$work/auth.sql"
docker exec "$container" createdb -U postgres "$database"
created_database=true
query() { docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 >&3 2>&3; }
docker exec -i "$container" psql -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 < "$work/auth.sql" >&3 2>&3
docker exec "$container" psql -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -c 'create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions;' >&3 2>&3
query < database/ci/baseline.sql
billing_migrations=()
for migration in supabase/migrations/*.sql; do
  version=$(basename "$migration" | cut -d_ -f1)
  [[ "$version" > 20261029201439 ]] || continue
  echo "$migration" >&3
  if [[ "$version" > 20261112044629 ]]; then
    billing_migrations+=("$migration")
    continue
  fi
  if [[ "$version" == 20261108090000 ]]; then
    while IFS= read -r line; do
      if [[ "$line" == '\ir ../../supabase/migrations/20261108090000_sellable_product.sql' ]]; then cat "$migration"; else printf '%s\n' "$line"; fi
    done < database/tests/sellable-product-backfill.sql | query
  else
    query < "$migration"
  fi
done
query <<'SQL'
insert into garments_erp.contacts(id,company_name) values (983001,'Historical freight fixture');
insert into garments_erp.contact_purpose(id,type) values (983001,'Historical freight fixture');
insert into garments_erp.transporter(id,contacts_id,contact_purpose_id) values (983001,983001,983001);
insert into garments_erp.transport(id,transporter_id,transport_status_type_id)
select fixture.id,983001,s.id from (values(983001),(983002)) fixture(id)
cross join garments_erp.transport_status_type s where s.type='draft';
insert into garments_erp.transport_bill(id,invoice_number) values (983001,'LEGACY-001');
insert into garments_erp.transport_docket(id,transport_id,docket_number,transport_number_id,amount)
values (983001,983001,'LEGACY-A',983001,45),(983002,983002,'LEGACY-B',983001,70);
insert into garments_erp.transport_bill_item(transport_bill_id,transport_docket_id,billed_amount)
values (983001,983001,55);
SQL
node scripts/ci/test-billing-release.mjs "$database" "${billing_migrations[@]}"
query <<'SQL'
do $$
begin
  if (select count(*) from garments_erp.transport_bill_item where transport_bill_id=983001) <> 2
     or not exists (select 1 from garments_erp.transport_bill_item
       where transport_docket_id=983001 and transport_bill_id=983001 and billed_amount=55)
     or not exists (select 1 from garments_erp.transport_docket
       where id=983002 and transport_id=983002 and docket_number='LEGACY-B' and amount=70)
     or exists (select 1 from information_schema.columns where table_schema='garments_erp'
       and table_name='transport_docket' and column_name='transport_number_id')
     or has_table_privilege('authenticated','garments_erp.transport_docket','insert') then
    raise exception 'Historical transport docket migration assertions failed';
  end if;
end;
$$;
SQL
echo 'PASS historical docket migration'

node database/ci/seed.mjs "$work/seed.sql"
query < "$work/seed.sql"
for sql in database/tests/billing-packing-dispatch.sql database/tests/access-schema-boundary.sql; do
  { echo "select set_config('request.jwt.claims','{\"aal\":\"aal2\",\"session_id\":\"10000000-0000-4000-8000-000000000001\"}',false);"; cat "$sql"; } | query
  echo "PASS $sql"
done
query <<'SQL'
insert into garments_erp.buyer_list(id,buyer_name) values (989001, 'Billing HTTP Test');
insert into garments_erp.transporter(id,contacts_id,contact_purpose_id) values (982001,900002,900001);
insert into garments_access.app_role_resource_permission(app_role_id,app_resource_id,can_view)
select role.id, resource.id, true from garments_access.app_role role
cross join garments_access.app_resource resource
where role.key='ci_viewer' and resource.key in ('billingCartons','billingPacking','billingReturns','billingDispatch');
SQL
{
  echo "select set_config('request.jwt.claims','{\"aal\":\"aal2\",\"session_id\":\"10000000-0000-4000-8000-000000000001\"}',false);"
  awk '/^do \$\$/{exit} !/^\\set/{print}' database/tests/billing-packing-dispatch.sql
  echo 'update garments_erp.po_item_piece_per_size set pieces_ordered=3 where po_item_id=982003; insert into garments_erp.task_board_data(production_id) values (982001); insert into garments_erp.job_item_status_list(job_id) values (982001); commit;'
} | query
network=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$container")
billing_jwt_secret=$(openssl rand -hex 32)
rest_id=$(docker run --rm -d --network "$network" -p 127.0.0.1::3000 \
  -e "PGRST_DB_URI=postgres://authenticator:postgres@$container:5432/$database" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e "PGRST_JWT_SECRET=$billing_jwt_secret" \
  public.ecr.aws/supabase/postgrest:v16.5)
rest_host=$(docker port "$rest_id" 3000/tcp)
for i in {1..30}; do
  if curl --silent --fail "http://$rest_host/" >/dev/null; then break; fi
  sleep 1
done
BILLING_TEST_SECRET="$billing_jwt_secret" BILLING_TEST_HOST="$rest_host" node fabric-poc/integration/billing-http.mjs

if [[ "${BILLING_TEST_AUTH:-0}" == 1 ]]; then
  auth_password=$(openssl rand -hex 24)
  query <<SQL
delete from auth.mfa_factors where friendly_name='SQL fixture';

update auth.users set instance_id='00000000-0000-0000-0000-000000000000',
  aud='authenticated', role='authenticated', email_confirmed_at=now(), created_at=now(), updated_at=now(),
  confirmation_token='', recovery_token='', email_change_token_new='', email_change='',
  email_change_token_current='', reauthentication_token='', phone_change='', phone_change_token='',
  encrypted_password=extensions.crypt('$auth_password', extensions.gen_salt('bf'))
where email in ('admin@example.invalid','viewer@example.invalid');
insert into auth.identities(id,user_id,provider_id,provider,identity_data,created_at,updated_at)
select gen_random_uuid(),id,id::text,'email',jsonb_build_object('sub',id,'email',email),now(),now()
from auth.users where email in ('admin@example.invalid','viewer@example.invalid');
SQL
  docker exec "$container" pg_dump -U postgres -d postgres --data-only -t auth.schema_migrations |
    docker exec -i "$container" psql -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 >&3 2>&3
  auth_image=$(docker inspect -f '{{.Config.Image}}' supabase_auth_garments-erp-ci)
  auth_id=$(docker run -d --network "$network" -p 127.0.0.1::9999 \
    -e API_EXTERNAL_URL=http://localhost:9999 -e GOTRUE_SITE_URL=http://localhost:9999 \
    -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 \
    -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_MIGRATIONS_PATH=/usr/local/etc/auth/migrations \
    -e "GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:postgres@$container:5432/$database" \
    -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
    -e "GOTRUE_JWT_SECRET=$billing_jwt_secret" -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
    -e GOTRUE_MFA_TOTP_ENROLL_ENABLED=true -e GOTRUE_MFA_TOTP_VERIFY_ENABLED=true "$auth_image")
  auth_host=$(docker port "$auth_id" 9999/tcp)
  for i in {1..30}; do
    if curl --silent --fail "http://$auth_host/health" >/dev/null; then break; fi
    if ! docker inspect -f '{{.State.Running}}' "$auth_id" >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if ! curl --silent --fail "http://$auth_host/health" >/dev/null; then
    docker logs "$auth_id" 2>&1 | tail -c 3500
    exit 1
  fi
  BILLING_AUTH_BROWSER_FIXTURE="$work/auth-browser.json" \
    BILLING_AUTH_HOST="$auth_host" BILLING_AUTH_PASSWORD="$auth_password" BILLING_TEST_HOST="$rest_host" \
    node fabric-poc/integration/billing-auth.mjs || { docker logs "$auth_id" 2>&1 | tail -c 3500; exit 1; }
fi

if [[ "${BILLING_TEST_CHROMIUM:-0}" == 1 ]]; then
  if ! VITE_SUPABASE_URL=https://example.invalid VITE_SUPABASE_ANON_KEY=example \
    npm --prefix fabric-poc run build -- --outDir "$work/browser-dist" > "$work/browser-build.log" 2>&1; then
    tail -c 8000 "$work/browser-build.log"
    exit 1
  fi
  BILLING_TEST_SECRET="$billing_jwt_secret" BILLING_TEST_HOST="$rest_host" \
    BILLING_AUTH_HOST="${auth_host:-}" BILLING_AUTH_BROWSER_FIXTURE="$work/auth-browser.json" \
    E2E_LOCAL_DIST="$work/browser-dist" E2E_LOCAL_PORT="${E2E_LOCAL_PORT:-18772}" \
    npm --prefix fabric-poc run e2e -- billing-workflow-local.spec.js \
    --output="${BILLING_BROWSER_OUTPUT:-/tmp/garments-billing-workflow}"
fi
