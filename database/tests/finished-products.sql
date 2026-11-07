-- Disposable CI database. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2","session_id":"10000000-0000-4000-8000-000000000001"}',true);

insert into garments_erp.stage_type(id,name) values (981001,'Complete'), (981002,'Finished test in progress');
insert into garments_erp.stage(id,name,abbr,sort_order,stage_type_id,track_pieces)
values (981001,'Finished test complete','FTC',981001,981001,false),
       (981002,'Finished test sewing','FTS',981002,981002,false);
insert into garments_erp.item(id,style_code) values (981001,'Finished test item'), (981002,'Other test item');
insert into garments_erp.part_list(id,part) values (981001,'Finished test body'), (981002,'Finished test sleeve');
insert into garments_erp.item_part(id,item_id,part_list_id)
values (981001,981001,981001), (981002,981001,981002);
insert into garments_erp.size_list(id,size) values (981001,'Finished test S');
insert into garments_erp.item_size_list(id,item_id,size_list_id)
values (981001,981001,981001), (981002,981002,981001);
insert into garments_erp.production(id,item_part_id) overriding system value values (981001,981001), (981002,981002);
insert into garments_erp.job(id,production_id,stage_id,job_code,latest)
values (981001,981001,981001,'FT-JOB-1',true), (981002,981002,981002,'FT-JOB-2',true);

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
values (981003,981002,981001,'FT-JOB-3',true);

set local role authenticated;
do $$
declare
  receipt text;
  adjustment text;
begin
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
