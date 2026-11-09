begin;

-- Preserve object identities, ownership, grants, policies and trigger bindings.
alter table garments_access.app_file_route set schema garments_erp;
alter table garments_access.app_file_upload set schema garments_erp;
alter table garments_access.dyed_bill_attestation set schema garments_erp;
alter table garments_access.employee_attestation set schema garments_erp;
alter table garments_access.production_attestation set schema garments_erp;

do $move$
declare
  business_functions constant text[] := array[
    'add_lab_dip_review', 'attest_dyed_bill', 'attest_production',
    'begin_file_upload', 'cancel_bucket_removal', 'cancel_file_upload',
    'create_bucket_group', 'dyed_bill_verifiers', 'edit_production_task',
    'employee_attest', 'employee_document', 'employee_snapshot', 'fabric_contract',
    'fabric_json', 'fabric_row_in_document', 'fabric_snapshot', 'file_cleanup',
    'file_cleanup_done', 'file_list', 'file_read', 'file_record', 'file_records',
    'file_registry', 'file_routes', 'file_target', 'file_target_definition',
    'finish_bucket_removal', 'finish_file_upload', 'guard_item_costing',
    'guard_item_costing_item', 'move_production', 'prepare_bucket_removal',
    'production_document', 'production_path', 'production_row_owned',
    'production_setup_contract', 'production_snapshot', 'production_workspace',
    'raw_material_transaction_snapshot', 'save_bucket_group', 'save_employee',
    'save_employee_reference', 'save_fabric_document', 'save_fabric_document_core',
    'save_file_route', 'save_job_status', 'save_production_board',
    'save_production_setup', 'save_raw_material_setup', 'save_raw_material_transaction',
    'save_verified_dyed_bill', 'set_employee_active', 'stamp_employee_operator',
    'stamp_updated_at'
  ];
  -- Include legacy references to stock functions already moved by billing alignment.
  reference_pattern constant text := '\mgarments_access\.(' || array_to_string(
    business_functions || array[
      'app_file_route', 'app_file_upload', 'dyed_bill_attestation',
      'employee_attestation', 'production_attestation',
      'finished_stock', 'create_finished_stock', 'adjust_finished_stock'
    ], '|'
  ) || ')\M';
  function_name text;
  routine record;
begin
  foreach function_name in array business_functions loop
    if not exists (
      select 1 from pg_proc
      where pronamespace = 'garments_access'::regnamespace and proname = function_name
    ) then
      raise exception 'Expected business function garments_access.%', function_name;
    end if;
    for routine in
      select oid::regprocedure as signature from pg_proc
      where pronamespace = 'garments_access'::regnamespace and proname = function_name
    loop
      execute format('alter function %s set schema garments_erp', routine.signature);
    end loop;
  end loop;

  -- SQL and PL/pgSQL string bodies can contain schema-qualified references.
  -- CREATE OR REPLACE retains each routine's owner and grants, including public RPCs.
  for routine in
    select p.oid from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('garments_erp', 'garments_access', 'public', 'auth', 'storage')
      and p.prokind = 'f' and p.prosrc ~ reference_pattern
    order by (n.nspname = 'public'), p.oid
  loop
    execute regexp_replace(
      pg_get_functiondef(routine.oid), reference_pattern, 'garments_erp.\1', 'g'
    );
  end loop;
end
$move$;

commit;
