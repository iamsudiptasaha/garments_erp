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
rollback;
