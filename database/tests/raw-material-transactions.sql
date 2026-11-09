-- Run in the disposable CI database. Fixture rows are rolled back.
begin;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2","session_id":"10000000-0000-4000-8000-000000000001"}',true);

insert into garments_erp.contact_purpose(id,type) values (985001,'Inventory test supplier');
set local role authenticated;
do $$
declare
  category jsonb;
  unit jsonb;
  supplier jsonb;
  material jsonb;
  order_data jsonb;
  issue_type jsonb;
  receipt jsonb;
  issue jsonb;
  receipt_values jsonb := '{"inward_date":"2026-11-08","billed_quantity":10,"billed_price":2}';
  issue_values jsonb := '{"date":"2026-11-08","quantity":4}';
begin
  category := public.erp_save_raw_material_setup('materialCategories',null,null,'{"name":"Inventory test category"}',null)->'row';
  unit := public.erp_save_raw_material_setup('materialUnits',null,null,'{"unit":"Inventory test piece"}',null)->'row';
  supplier := public.erp_save_raw_material_setup('materialSuppliers',null,null,
    '{"contacts_id":"900001","contact_purpose_id":"985001"}',null)->'row';
  material := public.erp_save_raw_material_setup('materials',null,null,
    jsonb_build_object('name','Inventory test material','category_list_id',category->>'id','unit_of_measure_id',unit->>'id'),null)->'row';
  issue_type := public.erp_save_raw_material_setup('materialIssueTypes',null,null,'{"name":"Inventory test issue"}',null)->'row';
  order_data := public.erp_save_raw_material_setup('materialOrders',null,null,
    jsonb_build_object('purchase_order_number','Inventory test PO','raw_material_supplier_list_id',supplier->>'id'),
    jsonb_build_array(jsonb_build_object('raw_material_item_id',material->>'id','quantity',10,'price',2)));
  receipt_values := receipt_values || jsonb_build_object('raw_material_item_id',material->>'id',
    'raw_material_purchase_order_item_id',order_data->'lines'->0->>'id');
  issue_values := issue_values || jsonb_build_object('check_out_type_id',issue_type->>'id');

  receipt := public.erp_save_raw_material_transaction('materialReceipts',null,null,
    receipt_values || jsonb_build_object('material_category_id',category->>'id'));
  if receipt->>'material_category_id' is distinct from category->>'id' then
    raise exception 'TEST: receipt category did not persist on create';
  end if;
  receipt := public.erp_save_raw_material_transaction('materialReceipts',(receipt->>'id')::bigint,
    (receipt->>'updated_at')::timestamptz,receipt_values);
  if receipt->>'material_category_id' is distinct from category->>'id' then
    raise exception 'TEST: legacy receipt edit cleared category';
  end if;
  begin
    perform public.erp_save_raw_material_transaction('materialReceipts',(receipt->>'id')::bigint,
      (receipt->>'updated_at')::timestamptz,receipt_values || '{"material_category_id":-1}');
    raise exception 'TEST: unknown receipt category accepted';
  exception when foreign_key_violation then null;
  end;
  if jsonb_typeof(receipt->'id') <> 'string' or (receipt->>'billed_quantity')::numeric <> 10 then
    raise exception 'Receipt response has an invalid identity or quantity';
  end if;

  begin
    perform public.erp_save_raw_material_setup('materialOrders',(order_data->'row'->>'id')::bigint,
      (order_data->'row'->>'updated_at')::timestamptz,
      jsonb_build_object('purchase_order_number','Inventory test PO','raw_material_supplier_list_id',supplier->>'id'),
      jsonb_build_array(jsonb_build_object('raw_material_item_id',material->>'id','quantity',11,'price',2)));
    raise exception 'TEST: received order line was replaced';
  exception when foreign_key_violation then null;
  end;

  issue_values := issue_values || jsonb_build_object('raw_material_check_in_id',receipt->>'id');
  if not exists (
    select 1 from jsonb_array_elements(public.erp_raw_material_transaction_snapshot()->'stage') row
    where row->>'abbr' = 'CUT'
  ) then raise exception 'TEST: checkout stage options unavailable'; end if;
  issue := public.erp_save_raw_material_transaction('materialIssues',null,null,issue_values);
  if issue->>'stage_id' is not null then raise exception 'TEST: omitted stage was populated'; end if;
  issue := public.erp_save_raw_material_transaction('materialIssues',(issue->>'id')::bigint,
    (issue->>'updated_at')::timestamptz,issue_values || jsonb_build_object('stage_id',(
      select row->>'id' from jsonb_array_elements(public.erp_raw_material_transaction_snapshot()->'stage') row
      where row->>'abbr' = 'CUT'
    )));
  if issue->>'stage_id' is null then raise exception 'TEST: checkout stage did not persist'; end if;
  begin
    perform public.erp_save_raw_material_transaction('materialIssues',(issue->>'id')::bigint,
      (issue->>'updated_at')::timestamptz,issue_values || '{"stage_id":-1}');
    raise exception 'TEST: unknown checkout stage accepted';
  exception when foreign_key_violation then null;
  end;
  if (issue->>'quantity')::numeric <> 4 then raise exception 'Issue quantity was not saved'; end if;

  if not exists (
    select 1 from jsonb_array_elements(public.erp_raw_material_transaction_snapshot()->'raw_material_check_out') row
    where row->>'id' = issue->>'id'
  ) then raise exception 'Snapshot did not return the persisted issue'; end if;

  begin
    perform public.erp_save_raw_material_transaction('materialIssues',null,null,issue_values || '{"quantity":7}');
    raise exception 'TEST: overdraw accepted';
  exception when raise_exception then
    if sqlerrm <> 'Issue exceeds available stock or receipt is closed' then raise; end if;
  end;

  begin
    perform public.erp_save_raw_material_transaction('materialReceipts',(receipt->>'id')::bigint,
      (receipt->>'updated_at')::timestamptz,receipt_values || '{"billed_quantity":3}');
    raise exception 'TEST: receipt lowered below issued quantity';
  exception when raise_exception then
    if sqlerrm <> 'Receipt source or quantity conflicts with existing stock issues' then raise; end if;
  end;

  begin
    perform public.erp_save_raw_material_transaction('materialIssues',(issue->>'id')::bigint,
      '2000-01-01',issue_values);
    raise exception 'TEST: stale issue update accepted';
  exception when serialization_failure then null;
  end;

  perform public.erp_save_raw_material_transaction('materialIssues',null,null,
    issue_values || '{"quantity":6,"reconciliation":true,"issue_by_employee_id":"900001","remarks":"Closing count"}');

  begin
    perform public.erp_save_raw_material_transaction('materialIssues',null,null,issue_values);
    raise exception 'TEST: closed receipt reopened';
  exception when raise_exception then
    if sqlerrm <> 'Issue exceeds available stock or receipt is closed' then raise; end if;
  end;
end;
$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","aal":"aal2","session_id":"10000000-0000-4000-8000-000000000002"}',true);
do $$
begin
  begin
    perform public.erp_save_raw_material_transaction('materialReceipts',null,null,'{}');
    raise exception 'TEST: user without Inventory write access was permitted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

do $$
begin
  if has_function_privilege('anon','public.erp_save_raw_material_transaction(text,bigint,timestamptz,jsonb)','execute')
    or has_function_privilege('anon','public.erp_raw_material_transaction_snapshot()','execute') then
    raise exception 'Anonymous role can execute the Inventory save RPC';
  end if;
end;
$$;
rollback;
