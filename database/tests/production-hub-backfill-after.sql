-- Run after applying the migration to the populated backfill fixture database.
begin;
do $$declare p bigint;begin
 if not exists(select 1 from garments_erp.employee where id=900002 and is_verified and verified_by_employee_id=900001)
  then raise exception 'Backfill lost existing employee verification';end if;
 select production_id into strict p from garments_erp.job where id=980001;
 if not exists(select 1 from garments_erp.production where id=p and item_part_id=980001)
  or not exists(select 1 from garments_erp.job where id=980002 and production_id=p and latest)
  or exists(select 1 from garments_erp.job where id=980001 and latest)
  then raise exception 'Backfill lost production identity or current job';end if;
 if (select count(*) from garments_erp.job_assignees where production_id=p)<>2
  or (select count(*) from garments_erp.task_board_data where production_id=p)<>1
  or (select count(*) from garments_erp.job_item_status_list where job_id in(980001,980002) and item_status_list_id=980001)<>2
  then raise exception 'Backfill lost assignees, board or job status';end if;
 if not exists(select 1 from garments_erp.lab_dip_version_item where lab_dip_version_id=980001 and latest and date='2026-11-01' and comments='Preserve review' and lab_dip_status_id=980001)
  then raise exception 'Backfill lost Lab Dip review';end if;
 if not exists(select 1 from garments_erp.raw_material_check_in where id=980001 and inward_date='2026-11-02' and billed_quantity=7 and billed_price=15.5 and raw_material_purchase_order_item_id=980001)
  then raise exception 'Backfill lost receipt values or purchase line';end if;
 if exists(select 1 from garments_erp.job_transition_log where production_id=p)
  then raise exception 'Migration fabricated historical transitions';end if;
 if not exists(select 1 from garments_erp.dyeing_program_item where id=980002 and batch_no=980001)
  then raise exception 'Backfill lost previous batch mapping identity';end if;
 if not exists(select 1 from garments_erp.view_knitted_fabric_name where id=980001 and fabric_name='30s Backfill jersey')
  then raise exception 'Derived fabric name lost';end if;
 begin
  insert into garments_erp.raw_material_check_in(dyed_fabric_item_id,raw_material_purchase_order_item_id,billed_quantity)
  values(980001,980001,1);
  raise exception 'TEST: dyed receipt accepted a material PO line';
 exception when check_violation then null;end;
 insert into garments_erp.raw_material_item(id,name,category_list_id,unit_of_measure_id) values(980002,'Other material',980001,980001);
 begin
  insert into garments_erp.raw_material_check_in(raw_material_item_id,raw_material_purchase_order_item_id,billed_quantity)
  values(980002,980001,1);
  raise exception 'TEST: receipt accepted a PO line for another material';
 exception when foreign_key_violation then null;end;
 raise notice 'PASS populated migration backfill';
end $$;
rollback;
