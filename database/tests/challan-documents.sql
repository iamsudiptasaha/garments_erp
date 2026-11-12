\set ON_ERROR_STOP on
begin;
\ir challan-fixture.sql

insert into garments_access.app_role_resource_permission(app_role_id,app_resource_id,can_view)
select role.id,resource.id,true from garments_access.app_role role,garments_access.app_resource resource
where role.key='ci_viewer' and resource.key='productionChallans';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000002"}',true);

do $$
begin
  if has_function_privilege('anon','public.erp_challan_documents(boolean)','execute')
     or has_table_privilege('authenticated','garments_erp.job_worker_bill_items','INSERT') then
    raise exception 'Document boundary exposed';
  end if;
  perform public.erp_challan_documents(false);
  begin
    perform public.erp_challan_documents(true);
    raise exception 'Billing read permitted for challan viewer';
  exception when insufficient_privilege then null; end;
  begin
    perform public.erp_save_challan_document(false,'create','{}');
    raise exception 'Challan write permitted for viewer';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000001"}',true);
do $$
declare
  line jsonb := '{"assignment":"974001","rate":"12","quantities":{"Test S":"24","Test M":"8"}}';
  first_id text; second_id text; b text; sibling_bill text; first_row jsonb; second_row jsonb; bill jsonb; item jsonb;
begin
  begin
    perform public.erp_save_challan_document(false,'create',jsonb_build_object('lines',
      jsonb_build_array(line||'{"quantities":{"Test S":"23","Test M":"8"}}')));
    raise exception 'Partial quantities accepted' using errcode='XX000';
  exception when raise_exception then null; end;
  begin
    perform public.erp_save_challan_document(false,'create',jsonb_build_object('lines',
      jsonb_build_array(line,line||'{"assignment":"974002"}')));
    raise exception 'Mixed workers accepted' using errcode='XX000';
  exception when raise_exception then null; end;
  first_id := public.erp_save_challan_document(false,'create',jsonb_build_object('date','2026-11-11',
    'employee','900001','lines',jsonb_build_array(line,line)));
  second_id := public.erp_save_challan_document(false,'create',jsonb_build_object('lines',jsonb_build_array(line)));
  select x into first_row from jsonb_array_elements(public.erp_challan_documents(false)->'challans') x where x->>'key'=first_id;
  select x into second_row from jsonb_array_elements(public.erp_challan_documents(false)->'challans') x where x->>'key'=second_id;
  if jsonb_array_length(first_row->'lines')<>2 or second_row#>'{lines,0,quantities}' is distinct from line->'quantities' then
    raise exception 'Repeated issuance or multi-line read failed';
  end if;
  item := jsonb_build_object('line',first_row#>>'{lines,0,id}','rate','3');
  b := public.erp_save_challan_document(true,'create',jsonb_build_object('invoiceNumber','TEST','lines',
    jsonb_build_array(item,jsonb_build_object('line',second_row#>>'{lines,0,id}','rate','4'))));
  sibling_bill := public.erp_save_challan_document(true,'create',jsonb_build_object('lines',
    jsonb_build_array(jsonb_build_object('line',first_row#>>'{lines,1,id}','rate','5'))));
  begin
    perform public.erp_save_challan_document(true,'create',jsonb_build_object('lines',jsonb_build_array(item)));
    raise exception 'Duplicate billing accepted';
  exception when unique_violation then null; end;
  begin
    perform public.erp_save_challan_document(false,'delete',first_row);
    raise exception 'Billed challan deleted' using errcode='XX000';
  exception when raise_exception then null; end;
  select x into bill from jsonb_array_elements(public.erp_challan_documents(true)->'bills') x where x->>'key'=b;
  if jsonb_array_length(bill->'items')<>2 then raise exception 'Multi-challan bill failed'; end if;
  perform public.erp_save_challan_document(true,'edit',bill||jsonb_build_object('invoiceNumber','EDITED','lines',bill->'items'));
  begin
    perform public.erp_save_challan_document(true,'edit',bill||jsonb_build_object('lines',bill->'items'));
    raise exception 'Stale edit accepted';
  exception when serialization_failure then null; end;
  select x into bill from jsonb_array_elements(public.erp_challan_documents(true)->'bills') x where x->>'key'=b;
  if bill->>'invoiceNumber'<>'EDITED' then raise exception 'Bill edit failed'; end if;
  perform public.erp_save_challan_document(true,'delete',bill);
  select x into bill from jsonb_array_elements(public.erp_challan_documents(true)->'bills') x where x->>'key'=sibling_bill;
  perform public.erp_save_challan_document(true,'delete',bill);
  perform public.erp_save_challan_document(false,'edit',first_row||jsonb_build_object('lines',
    jsonb_build_array(line||jsonb_build_object('id',first_row#>>'{lines,0,id}','description','EDITED'))));
  select x into first_row from jsonb_array_elements(public.erp_challan_documents(false)->'challans') x where x->>'key'=first_id;
  if first_row#>>'{lines,0,description}'<>'EDITED' or jsonb_array_length(first_row->'lines')<>1 then
    raise exception 'Challan edit failed';
  end if;
  perform public.erp_save_challan_document(false,'delete',first_row);
  perform public.erp_save_challan_document(false,'delete',second_row);
  if exists(select 1 from jsonb_array_elements(public.erp_challan_documents(false)->'challans') x where x->>'key' in (first_id,second_id)) then
    raise exception 'Challan delete failed';
  end if;
end $$;
rollback;
