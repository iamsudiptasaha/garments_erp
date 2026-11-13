-- Preserve each existing write boundary and include its authoritative record ID.
-- Check the exact prior return before replacing it so a changed API fails closed.
do $$
declare
  change record;
  definition text;
begin
  for change in select * from (values
    ('garments_erp.save_fabric_document_core(text,jsonb,text,jsonb,bigint)', 'fabric_snapshot', 'root_id'),
    ('garments_erp.save_production_setup(text,jsonb,text,jsonb)', 'production_workspace', 'root_id'),
    ('garments_erp.save_employee(jsonb,uuid)', 'employee_snapshot', 'eid::text')
  ) as changes(signature, snapshot, receipt) loop
    definition := pg_get_functiondef(change.signature::regprocedure);
    if definition ~ ('return garments_(erp|access)\.' || change.snapshot || '\(\);') then
      execute regexp_replace(definition,
        '(return garments_(erp|access)\.' || change.snapshot || '\(\));',
        '\1 || jsonb_build_object(''_saved_id'', ' || change.receipt || ');');
    else
      raise exception 'Unexpected save API definition for %', change.signature;
    end if;
  end loop;
end $$;
