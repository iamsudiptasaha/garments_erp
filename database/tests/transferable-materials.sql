begin;
\ir transferable-materials-fixture.sql
create function pg_temp.expect_error(q text,code text) returns void language plpgsql as $$
begin
 begin execute q; exception when others then
   if sqlstate=code then return; end if; raise;
 end;
 raise exception 'TEST expected % from %',code,q;
end $$;
set local role authenticated;
do $$
declare last_event jsonb; first_event jsonb; receipt_stamp timestamptz; kind bigint;
begin
 select (r->>'updated_at')::timestamptz into receipt_stamp
 from jsonb_array_elements(public.erp_raw_material_transaction_snapshot()->'raw_material_check_in') r where r->>'id'='995001';
 -- Invalid initial Return / Restore, then every valid transition, including repetition.
 foreach kind in array array[2,4] loop
  perform pg_temp.expect_error(format('select public.erp_record_transferable_movement(995001,null,%L,%s,null,null,900001,null)',receipt_stamp,kind),'23514');
 end loop;
 perform pg_temp.expect_error(format('select public.erp_record_transferable_movement(995001,null,%L,1,null,995001,900001,null)',receipt_stamp),'23514');
 perform pg_temp.expect_error(format('select public.erp_record_transferable_movement(995001,null,%L,1,995001,-1,900001,null)',receipt_stamp),'23503');
 perform pg_temp.expect_error(format('select public.erp_record_transferable_movement(995001,null,%L,1,-1,995001,900001,null)',receipt_stamp),'23503');
 perform pg_temp.expect_error(format('select public.erp_record_transferable_movement(995001,null,%L,9,null,null,900001,null)',receipt_stamp),'23503');
 perform pg_temp.expect_error(format('select public.erp_record_transferable_movement(995001,null,%L,3,null,null,900001,null)',receipt_stamp),'23514');
 perform pg_temp.expect_error(format('select public.erp_record_transferable_movement(995001,null,%L,1,995001,995001,-1,null)',receipt_stamp),'23503');
 perform pg_temp.expect_error(format('select public.erp_record_transferable_movement(995001,null,%L,1,995001,995001,null,null)',receipt_stamp),'23502');
 last_event:=public.erp_record_transferable_movement(995001,null,receipt_stamp,1,995001,995001,900001,'First transfer');
 first_event:=last_event;
 perform pg_temp.expect_error(format('select public.erp_record_transferable_movement(995001,%s,%L,1,995002,995001,900001,null)',last_event->>'id',receipt_stamp),'23514');
 perform pg_temp.expect_error(format('select public.erp_record_transferable_movement(995001,%s,%L,3,null,null,900001,%L)',last_event->>'id',receipt_stamp,'Cannot discard assigned'),'23514');
 perform pg_temp.expect_error(format('select public.erp_record_transferable_movement(995001,null,%L,2,null,null,900001,null)',receipt_stamp),'40001');
 last_event:=public.erp_record_transferable_movement(995001,(last_event->>'id')::bigint,receipt_stamp,2,null,null,900001,'Returned');
 if last_event->>'job_worker_id'<>'995001' then raise exception 'Return lost custodian'; end if;
 last_event:=public.erp_record_transferable_movement(995001,(last_event->>'id')::bigint,receipt_stamp,1,995002,995001,900001,'Reissued');
 last_event:=public.erp_record_transferable_movement(995001,(last_event->>'id')::bigint,receipt_stamp,2,null,null,900001,null);
 last_event:=public.erp_record_transferable_movement(995001,(last_event->>'id')::bigint,receipt_stamp,3,null,null,900001,'Damaged');
 perform pg_temp.expect_error(format('select public.erp_record_transferable_movement(995001,%s,%L,1,995001,995001,900001,null)',last_event->>'id',receipt_stamp),'23514');
 last_event:=public.erp_record_transferable_movement(995001,(last_event->>'id')::bigint,receipt_stamp,4,null,null,900001,'Repaired');
 last_event:=public.erp_record_transferable_movement(995001,(last_event->>'id')::bigint,receipt_stamp,3,null,null,900001,'Discard restored receipt');
 last_event:=public.erp_record_transferable_movement(995001,(last_event->>'id')::bigint,receipt_stamp,4,null,null,900001,'Restore again');
 if (last_event->>'movement_at')::timestamptz<=(first_event->>'movement_at')::timestamptz then raise exception 'Event order invalid'; end if;
 -- Never-transferred receipt can be discarded.
 select (r->>'updated_at')::timestamptz into receipt_stamp from jsonb_array_elements(public.erp_raw_material_transaction_snapshot()->'raw_material_check_in') r where r->>'id'='995002';
 perform public.erp_record_transferable_movement(995002,null,receipt_stamp,3,null,null,900001,'Unused damage');
 perform pg_temp.expect_error($q$select public.erp_save_raw_material_transaction('materialIssues',null,null,'{"raw_material_check_in_id":995001,"date":"2026-11-22","quantity":1,"check_out_type_id":995001}')$q$,'23514');
 perform pg_temp.expect_error($q$select public.erp_save_raw_material_transaction('materialIssues',null,null,'{"raw_material_check_in_id":995001,"date":"2026-11-22","quantity":12,"reconciliation":true,"issue_by_employee_id":900001,"remarks":"Close"}')$q$,'23514');
 perform pg_temp.expect_error('insert into garments_erp.transferable_item_movement(raw_material_check_in_id) values(995001)','42501');
end $$;
reset role;
-- Direct writes/imports/legacy command paths still meet table guards.
select pg_temp.expect_error('update garments_erp.raw_material_check_in set is_transferable=false where id=995001','23514');
select pg_temp.expect_error('update garments_erp.raw_material_check_in set billed_quantity=13 where id=995001','23514');
select pg_temp.expect_error('update garments_erp.raw_material_check_in set sku=''REPLACED'' where id=995001','23514');
select pg_temp.expect_error('delete from garments_erp.raw_material_check_in where id=995001','23514');
select pg_temp.expect_error('update garments_erp.transferable_item_movement set remarks=''Changed''','23514');
select pg_temp.expect_error('delete from garments_erp.transferable_item_movement','23514');
select pg_temp.expect_error('truncate garments_erp.transferable_item_movement','23514');
select pg_temp.expect_error('update garments_erp.transferable_item_movement_type set type=''Other'' where id=1','23514');
select pg_temp.expect_error('insert into garments_erp.raw_material_check_out(raw_material_check_in_id,date,quantity) values(995001,current_date,1)','23514');
insert into garments_erp.raw_material_check_out(id,raw_material_check_in_id,date,quantity) values(995001,995003,current_date,1);
select pg_temp.expect_error('update garments_erp.raw_material_check_in set is_transferable=true where id=995003','23514');
select pg_temp.expect_error('delete from garments_erp.raw_material_check_out where id=995001','23514');
select pg_temp.expect_error('update garments_erp.raw_material_check_out set raw_material_check_in_id=995004 where id=995001','23514');
select pg_temp.expect_error('update garments_erp.raw_material_check_in set is_transferable=true,raw_material_purchase_order_item_id=null where id=995004','23514');
-- Caller-supplied timestamp / ID cannot backdate or reorder events.
insert into garments_erp.transferable_item_movement(raw_material_check_in_id,transferable_item_movement_type_id,employee_id,remarks,movement_at)
 values(995001,3,900001,'Database ordering test','1900-01-01');
do $$ begin
 if exists(select 1 from garments_erp.transferable_item_movement where movement_at<'2026-01-01') then raise exception 'Caller backdated event';end if;
 if (select billed_quantity from garments_erp.raw_material_check_in where id=995001)<>12 then raise exception 'Receipt quantity changed';end if;
end $$;
-- Denied role, disabled account, invalid session and AAL1.
update garments_access.app_user set is_active=false where user_id='00000000-0000-4000-8000-000000000001';
select pg_temp.expect_error('select public.erp_record_transferable_movement(995001,null,null,1,995001,995001,900001,null)','42501');
update garments_access.app_user set is_active=true where user_id='00000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select pg_temp.expect_error('select public.erp_record_transferable_movement(995001,null,null,1,995001,995001,900001,null)','42501');
select pg_temp.expect_error('select public.erp_raw_material_transaction_snapshot()','42501');
select pg_temp.expect_error('update garments_erp.raw_material_check_in set is_transferable=false where id=995004','42501');
reset role;
insert into garments_access.app_role_resource_permission(app_role_id,app_resource_id,can_view)
 select role.id,r.id,true from garments_access.app_role role,garments_access.app_resource r
 where role.key='ci_viewer' and r.key='materialReceipts';
set local role authenticated;
do $$ declare snapshot jsonb; locked jsonb; begin
 snapshot:=public.erp_raw_material_transaction_snapshot();
 select r into locked from jsonb_array_elements(snapshot->'transferable_receipt_state') r where r->>'id'='995001';
 if locked->>'identity_locked'<>'true' or locked->>'status' is not null or locked->>'last_movement_id' is not null
   or snapshot->'transferable_item_movement'<>'[]'::jsonb or snapshot->'transferable_workers'<>'[]'::jsonb then
  raise exception 'Receipt-only viewer gained Transferable Materials details';
 end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal1","session_id":"10000000-0000-4000-8000-000000000001"}',true);
select pg_temp.expect_error('select public.erp_record_transferable_movement(995001,null,null,1,995001,995001,900001,null)','42501');
do $$ begin
 if has_function_privilege('anon','public.erp_record_transferable_movement(bigint,bigint,timestamptz,bigint,bigint,bigint,bigint,text)','execute')
 or has_table_privilege('authenticated','garments_erp.transferable_item_movement','insert')
 or has_table_privilege('service_role','garments_erp.transferable_item_movement','insert') then raise exception 'Unsafe movement grants';end if;
end $$;
rollback;
