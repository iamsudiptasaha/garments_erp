do $test$
declare
  table_name text;
  relation regclass;
begin
  foreach table_name in array array[
    'app_file_route', 'app_file_upload', 'dyed_bill_attestation',
    'employee_attestation', 'production_attestation'
  ] loop
    relation := to_regclass(format('garments_erp.%I', table_name));
    if relation is null or to_regclass(format('garments_access.%I', table_name)) is not null then
      raise exception 'Business table % is outside the ERP schema', table_name;
    end if;
    if not (select relrowsecurity from pg_class where oid = relation)
      or has_table_privilege('anon', relation, 'select,insert,update,delete')
      or has_table_privilege('authenticated', relation, 'select,insert,update,delete') then
      raise exception 'Business table % lost its access restrictions', table_name;
    end if;
  end loop;

  if exists (
    select 1 from pg_proc
    where pronamespace = 'garments_access'::regnamespace
      and proname not in (
        'access_snapshot', 'account_internal', 'account_security', 'admin_snapshot',
        'archive_role', 'consume_recovery', 'dyed_bill_user_allowed',
        'has_screen_permission', 'issue_recovery', 'production_user_allowed',
        'require_administrator', 'resource_available', 'save_account_access',
        'save_role', 'session_ready'
      )
  ) then
    raise exception 'Unexpected routine in garments_access. Review whether it belongs in garments_erp.';
  end if;

  if exists (
    select 1 from pg_class
    where relnamespace = 'garments_access'::regnamespace
      and relkind not in ('i', 'I', 'S')
      and relname not in (
        'account_recovery', 'app_activity_log', 'app_db_table', 'app_resource',
        'app_resource_table', 'app_role', 'app_role_resource_permission',
        'app_user', 'app_user_role'
      )
  ) then
    raise exception 'Unexpected relation in garments_access. Review whether it belongs in garments_erp.';
  end if;
end
$test$;
