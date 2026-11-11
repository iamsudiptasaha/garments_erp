-- Disposable CI database. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2","session_id":"10000000-0000-4000-8000-000000000001"}',true);

insert into garments_erp.stage_type(id,name) values (981002,'Finished test in progress');
insert into garments_erp.stage(id,name,abbr,sort_order,stage_type_id,track_pieces)
values (981002,'Finished test sewing','FTS',981002,981002,false);
insert into garments_erp.item(id,style_code) values (981001,'Finished test item'), (981002,'Other test item');
insert into garments_erp.part_list(id,part) values (981001,'Finished test body'), (981002,'Finished test sleeve');
insert into garments_erp.item_part(id,item_id,part_list_id)
values (981001,981001,981001), (981002,981001,981002);
insert into garments_erp.size_list(id,size) values (981001,'Finished test S');
insert into garments_erp.item_size_list(id,item_id,size_list_id)
values (981001,981001,981001), (981002,981002,981001);
insert into garments_erp.production(id,item_part_id) overriding system value values (981001,981001), (981002,981002);
insert into garments_erp.job(id,production_id,stage_id,job_code,latest)
values (981001,981001,(select id from garments_erp.stage where abbr = 'RTD'),'FT-JOB-1',true),
       (981002,981002,981002,'FT-JOB-2',true);

set local role authenticated;
do $$
begin
  begin
    perform public.erp_create_finished_production(981001,981001,900002,'{"981001":10}','98100000-0000-4000-8000-000000000001');
    raise exception 'TEST: incomplete item accepted';
  exception when raise_exception then
    if sqlerrm <> 'Every item part must have a current completed job' then raise; end if;
  end;
end;
$$;
reset role;
update garments_erp.job set latest = false where id = 981002;
insert into garments_erp.job(id,production_id,stage_id,job_code,latest)
values (981003,981002,(select id from garments_erp.stage where abbr = 'RTD'),'FT-JOB-3',true);

insert into garments_erp.variant(id,variant_name) values (981001,'Costing test variant');
insert into garments_erp.variant_item(id,item_part_id,variant_id)
values (981001,981001,981001), (981002,981002,981001);
insert into garments_erp.variant_item_per_job(id,job_id,variant_item_id)
values (981001,981001,981001), (981002,981003,981002);
insert into garments_erp.stage_pieces(item_size_list_id,variant_item_per_job_id,pieces_stock_in,pieces_stock_out)
values (981001,981001,12,0), (981001,981002,10,0);

set local role authenticated;
do $$
declare
  receipt text;
  adjustment text;
  costing jsonb;
  valuation jsonb;
  lines jsonb;
begin
  begin
    perform public.erp_create_finished_production(981001,981001,900002,'{"981001":10}','98100000-0000-4000-8000-000000000001');
    raise exception 'TEST: uncosted production accepted';
  exception when raise_exception then
    if sqlerrm <> 'Complete item costing to finalize production pieces' then raise; end if;
  end;
  perform public.erp_item_costing_start(981001);
  costing := public.erp_item_costing_read(981001)->0;
  if (costing->>'completed_units')::numeric is distinct from 10 then
    raise exception 'TEST: accepted units did not use limiting part';
  end if;
  select jsonb_agg(jsonb_build_object(
    'id', line->>'id',
    'approved_quantity', case when line->>'peripheral_type' is null then 10 else null end,
    'approved_rate', case line->>'peripheral_type' when 'discount' then 5 when 'profit' then 5
      else case when line->>'peripheral_type' is null then 10 else 0 end end
  )) into lines from jsonb_array_elements(costing->'lines') line;
  perform public.erp_item_costing_save((costing->>'id')::bigint,(costing->>'updated_at')::timestamptz,lines,false);
  costing := public.erp_item_costing_read(981001)->0;
  perform public.erp_item_costing_save((costing->>'id')::bigint,(costing->>'updated_at')::timestamptz,lines,true);
  if public.erp_item_costing_read(981001)->0->>'status' is distinct from 'finalized' then
    raise exception 'TEST: costing did not finalize';
  end if;
  costing := public.erp_item_costing_read(981001)->0;
  begin
    perform public.erp_item_costing_save((costing->>'id')::bigint,(costing->>'updated_at')::timestamptz,lines,false);
    raise exception 'TEST: finalized costing accepted an edit';
  exception when raise_exception then
    if sqlerrm <> 'Costing changed. Reload before saving.' then raise; end if;
  end;
  if (public.erp_item_costing_read(981001)->0) is distinct from costing then
    raise exception 'TEST: finalized costing history changed after rejected edit';
  end if;

  receipt := public.erp_create_finished_production(981001,981001,900002,'{"981001":10}','98100000-0000-4000-8000-000000000001');
  if receipt is distinct from public.erp_create_finished_production(981001,981001,900002,'{"981001":10}','98100000-0000-4000-8000-000000000001')
  then raise exception 'TEST: receipt retry changed result'; end if;

  perform public.erp_adjust_finished_stock(981001,981001,3,'Count correction',900002,'98100000-0000-4000-8000-000000000002');
  perform public.erp_adjust_finished_stock(981001,981001,0,'Count confirmed',900002,'98100000-0000-4000-8000-000000000003');
  adjustment := public.erp_adjust_finished_stock(981001,981001,-2,'Write-off',900002,'98100000-0000-4000-8000-000000000004');
  if adjustment is distinct from public.erp_adjust_finished_stock(981001,981001,-2,'Write-off',900002,'98100000-0000-4000-8000-000000000004')
  then raise exception 'TEST: adjustment retry changed result'; end if;
  if (public.erp_warehouse_stock(981001)->'sizes'->0->>'available')::integer is distinct from 11
  then raise exception 'TEST: incorrect available stock'; end if;

  select row into strict valuation
  from jsonb_array_elements(public.erp_finished_stock_valuation(200, 0)) row
  where row->>'item_id' = '981001';
  if (valuation->>'pieces')::numeric is distinct from 11
    or (valuation->>'base_price')::numeric is null
    or (valuation->>'stock_value')::numeric is distinct from 11 * (valuation->>'base_price')::numeric
  then raise exception 'TEST: valuation did not use physical stock and linked finalized costing'; end if;


  begin
    perform public.erp_adjust_finished_stock(981001,981001,-12,'Excess write-off',900002,'98100000-0000-4000-8000-000000000005');
    raise exception 'TEST: negative balance accepted';
  exception when raise_exception then
    if sqlerrm <> 'Adjustment would make stock negative' then raise; end if;
  end;
  begin
    perform public.erp_adjust_finished_stock(981001,981001,0.5,'Fraction',900002,'98100000-0000-4000-8000-000000000005');
    raise exception 'TEST: fractional adjustment accepted';
  exception when raise_exception then
    if sqlerrm <> 'Provide a signed whole quantity, reason and request ID' then raise; end if;
  end;
  begin
    perform public.erp_adjust_finished_stock(981001,981002,1,'Wrong size owner',900002,'98100000-0000-4000-8000-000000000005');
    raise exception 'TEST: size owned by another item accepted';
  exception when raise_exception then
    if sqlerrm <> 'Size does not belong to the manufactured item' then raise; end if;
  end;
end;
$$;
reset role;

do $$
begin
  if not exists (
    select 1 from garments_erp.item_costing c
    join garments_erp.item_produced r on r.id = c.item_produced_id and r.item_id = c.item_id
    where c.item_id = 981001
  ) then raise exception 'TEST: finalized costing did not link to production'; end if;
end;
$$;

insert into garments_erp.sellable_product (sku,name) values ('FINISHED-TEST','Finished test set')
returning id as variation_id \gset
insert into garments_erp.sellable_unit (sellable_product_id,item_id,item_size_list_id,share_weight)
values (:variation_id,981001,981001,2);
update garments_erp.sellable_product set verified_by_employee_id = 900002 where id = :variation_id;

do $$
begin
  if (public.erp_warehouse_stock(p_sku => 'FINISHED-TEST')->'variations'->0->>'capacity')::integer is distinct from 5
  then raise exception 'TEST: incorrect variation capacity'; end if;
  begin
    update garments_erp.sellable_unit set share_weight = 3 where item_id = 981001;
    raise exception 'TEST: verified recipe changed';
  exception when raise_exception then
    if sqlerrm <> 'Verified packing recipes are immutable' then raise; end if;
  end;
  begin
    update garments_erp.item set story = 'Changed' where id = 981001;
    raise exception 'TEST: locked item changed';
  exception when raise_exception then
    if sqlerrm <> 'Verified manufactured items are immutable' then raise; end if;
  end;
  begin
    delete from garments_erp.stock_adjustment where item_id = 981001;
    raise exception 'TEST: adjustment deleted';
  exception when raise_exception then
    if sqlerrm <> 'Verified finished stock records are immutable' then raise; end if;
  end;
  if to_regclass('garments_erp.item_sold') is not null
     or to_regclass('garments_erp.view_item_in_stock') is not null
     or has_function_privilege('anon','public.erp_warehouse_stock(bigint,text,bigint,integer,integer)','execute')
  then raise exception 'TEST: retired stock structures or anonymous stock access'; end if;
end;
$$;
set local role authenticated;
do $$
declare
  product_id text;
  price_type_id text;
  price_id text;
  catalogue jsonb;
  summary jsonb;
begin
  product_id := public.erp_create_finished_catalogue_entry('products', jsonb_build_object(
    'sku', 'FT-CATALOGUE', 'name', 'Finished test recipe', 'employee_id', '900002',
    'components', jsonb_build_array(jsonb_build_object('size_id', '981001', 'pieces', 2))
  ));
  price_type_id := public.erp_create_finished_catalogue_entry('priceTypes', '{"name":"Finished test wholesale"}');
  price_id := public.erp_create_finished_catalogue_entry('prices', jsonb_build_object(
    'product_id', product_id, 'type_id', price_type_id, 'version', 'v1',
    'price_per_piece', 62.5, 'date', '2026-11-09'
  ));
  catalogue := public.erp_finished_goods_catalogue();
  if not exists (
    select 1 from jsonb_array_elements(public.erp_finished_goods_movements(false, 50, 0)) r
    where r->>'item' = 'Finished test item' and (r->>'pieces')::integer = 10
  ) or not exists (
    select 1 from jsonb_array_elements(public.erp_finished_goods_movements(true, 50, 0)) r
    where r->>'reason' = 'Write-off' and (r->>'delta')::integer = -2
  ) then raise exception 'TEST: verified stock movement missing from history'; end if;
  summary := public.erp_finished_goods_summary('FT-CATALOGUE', 50, 0);
  if (summary->'sizes'->0->>'total_produced')::numeric is distinct from 10
    or (summary->'sizes'->0->>'available')::numeric is distinct from 11
    or (summary->'variations'->0->>'capacity')::numeric is distinct from 5
    or (summary->'variations'->0->>'available_percent')::numeric is distinct from 100
  then raise exception 'TEST: finished stock summary diverged from production and recipe'; end if;

  if not exists (
    select 1 from jsonb_array_elements(catalogue->'prices') p
    where p->>'id' = price_id and (p->>'price_per_piece')::numeric = 62.5
  ) or not exists (
    select 1 from jsonb_array_elements(catalogue->'products') p
    where p->>'id' = product_id and (p->'components'->0->>'pieces')::integer = 2
      and (p->'components'->0->>'reference_cost')::numeric > 0
  ) then raise exception 'TEST: manual pricing or read-only costing reference failed'; end if;
end;
$$;
reset role;

-- A signed-in user needs the Finished Goods grant to read either endpoint.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","aal":"aal2","session_id":"10000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
do $$
begin
  begin
    perform public.erp_finished_goods_catalogue();
    raise exception 'TEST: catalogue exposed without Finished Goods access';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.erp_finished_stock_valuation(50, 0);
    raise exception 'TEST: valuation exposed without Finished Goods access';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

insert into garments_access.app_role_resource_permission(app_role_id,app_resource_id,can_view)
select role.id, resource.id, true
from garments_access.app_role role, garments_access.app_resource resource
where role.key = 'ci_viewer' and resource.key = 'finishedProducts';

set local role authenticated;
do $$
begin
  if jsonb_array_length(public.erp_finished_goods_catalogue()->'prices') < 1
    or jsonb_array_length(public.erp_finished_stock_valuation(50, 0)) < 1
  then raise exception 'TEST: view-only Finished Goods access failed'; end if;
  begin
    perform public.erp_create_finished_catalogue_entry('priceTypes', '{"name":"Unauthorized type"}');
    raise exception 'TEST: view-only user created a price type';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
