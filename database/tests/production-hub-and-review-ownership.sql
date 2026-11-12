-- Disposable database only. All business fixtures and assertions roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(value boolean, message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'TEST: %',message;end if;end $$;
create function pg_temp.operator() returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-000000000001',
  'aal','aal2','session_id','10000000-0000-4000-8000-000000000001',
  'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now()))))::text,true);
end $$;
create function pg_temp.move(payload jsonb) returns jsonb language plpgsql as $$
begin
 payload:=payload||jsonb_build_object('verified_by','900001');
 if payload->>'action'<>'start' then
  payload:=payload||jsonb_build_object('expected_transition_id',(select coalesce(max(id),0)::text from garments_erp.job_transition_log where production_id=(payload->>'production_id')::bigint),
   'pieces',coalesce((select jsonb_agg(jsonb_build_object('variant_item_id',v.variant_item_id::text,'item_size_list_id',p.item_size_list_id::text,'pieces_stock_out',p.pieces_stock_out))
    from garments_erp.stage_pieces p join garments_erp.variant_item_per_job v on v.id=p.variant_item_per_job_id where v.job_id=(payload->>'from_job_id')::bigint),'[]'::jsonb));
 end if;
 return public.erp_move_production(payload,null);
end $$;
-- Schema, access and storage ownership assertions.
do $$declare t text;begin
 perform pg_temp.assert_true(to_regclass('garments_erp.job_status_history') is null,'obsolete job history removed');
 perform pg_temp.assert_true(not exists(select 1 from information_schema.columns where table_schema='garments_erp'
   and table_name='lab_dip_version' and column_name in ('date','comments','lab_dip_status_id')),'review fields removed from version');
 foreach t in array array['production','task_board_data','flags_list','task_board_data_flag','job_item_status_list','job_transition_log'] loop
  perform pg_temp.assert_true((select relrowsecurity from pg_class where oid=('garments_erp.'||t)::regclass),'RLS on '||t);
  perform pg_temp.assert_true(not has_table_privilege('authenticated','garments_erp.'||t,'select,insert,update,delete'),'no direct browser table grants: '||t);
  perform pg_temp.assert_true(not has_table_privilege('anon','garments_erp.'||t,'select,insert,update,delete'),'no anonymous table grants: '||t);
 end loop;
 perform pg_temp.assert_true(not has_function_privilege('anon','public.erp_move_production(jsonb,uuid)','execute'),'anonymous movement denied');
 perform pg_temp.assert_true(not has_function_privilege('authenticated','garments_access.production_user_allowed(uuid,text)','execute'),'private identity lookup');
end $$;
-- Seed an item/part, three tracked stages and two variants for exact allocation.
insert into garments_erp.stage_type(id,name) values(990001,'Migration test');
insert into garments_erp.stage(id,name,abbr,sort_order,stage_type_id,track_pieces)
 values(990001,'Test cutting','TCUT',-2147483500,990001,true),(990002,'Test sewing','TSEW',-2147483490,990001,true),(990003,'Test packing','TPAC',-2147483480,990001,true);
insert into garments_erp.item(id,style_code) values(990001,'Migration test');
insert into garments_erp.part_list(id,part) values(990001,'Migration test part');
insert into garments_erp.item_part(id,item_id,part_list_id) values(990001,990001,990001);
insert into garments_erp.size_list(id,size) values(990001,'Test M');
insert into garments_erp.item_size_list(id,size_list_id,item_id) values(990001,990001,990001);
insert into garments_erp.item_cut_ratio(item_size_list_id,pieces) values(990001,11);
insert into garments_erp.variant(id,variant_name) values(990001,'Test blue'),(990002,'Test red');
insert into garments_erp.variant_item(id,item_part_id,variant_id) values(990001,990001,990001),(990002,990001,990002);
insert into garments_erp.flags_list(id,name) overriding system value values(990001,'Test urgent');
select pg_temp.operator();
do $$
declare r jsonb; p bigint; c1 bigint; s1 bigint; s2 bigint; packing bigint; b bigint; payload jsonb;
begin
 -- MVP attribution is employee selection; authorization is still the portal actor.
 payload:=jsonb_build_object('action','start','item_part_id','990001','to_stage_id','990001');
 r:=pg_temp.move(payload);p:=(r->>'production_id')::bigint;c1:=(r->>'job_id')::bigint;
 perform pg_temp.assert_true((select sum(sp.pieces_stock_in)=11 from garments_erp.stage_pieces sp
   join garments_erp.variant_item_per_job v on v.id=sp.variant_item_per_job_id where v.job_id=c1),'largest remainder preserves planned total');
 perform pg_temp.assert_true((select max(sp.pieces_stock_in)-min(sp.pieces_stock_in)=1 from garments_erp.stage_pieces sp
   join garments_erp.variant_item_per_job v on v.id=sp.variant_item_per_job_id where v.job_id=c1),'equal variant shares');
 select id into b from garments_erp.task_board_data where production_id=p;
 perform public.erp_save_production_board(p,md5(garments_erp.production_document(p)::text),array[900001::bigint,900002],array[990001::bigint]);
 update garments_erp.stage_pieces set pieces_stock_out=pieces_stock_in-1
 where variant_item_per_job_id in(select id from garments_erp.variant_item_per_job where job_id=c1);
 r:=pg_temp.move(jsonb_build_object('action','advance','production_id',p::text,'from_job_id',c1::text,'to_stage_id','990002'));
 s1:=(r->>'job_id')::bigint;
 perform pg_temp.assert_true((select sum(sp.pieces_stock_in)=9 from garments_erp.stage_pieces sp join garments_erp.variant_item_per_job v on v.id=sp.variant_item_per_job_id where v.job_id=s1),'fresh handoff uses source output');
 update garments_erp.job set due_date='2026-12-04' where id=c1;
 r:=pg_temp.move(jsonb_build_object('action','rectify','production_id',p::text,'from_job_id',s1::text,'to_job_id',c1::text,'reason','Re-cut'));
 perform pg_temp.assert_true((select latest and complete_date is null and due_date='2026-12-04' from garments_erp.job where id=c1),'rectification reopens original job and preserves other fields');
 perform pg_temp.assert_true((select count(*)=2 from garments_erp.job where production_id=p),'rectification creates no job');
 r:=pg_temp.move(jsonb_build_object('action','advance','production_id',p::text,'from_job_id',c1::text,'to_stage_id','990002'));
 s2:=(r->>'job_id')::bigint;
 perform pg_temp.assert_true(s2<>s1,'re-advance creates a fresh sewing attempt');
 r:=pg_temp.move(jsonb_build_object('action','advance','production_id',p::text,'from_job_id',s2::text,'to_stage_id','990003'));
 packing:=(r->>'job_id')::bigint;
 perform pg_temp.assert_true(garments_erp.production_path(p)=array[c1,s2,packing],'working path excludes abandoned S1');
 perform pg_temp.assert_true((select count(*)=4 from garments_erp.job_transition_log where production_id=p),'every movement preserved');
 perform pg_temp.assert_true((select id=b from garments_erp.task_board_data where production_id=p),'board identity survives stage changes');
 perform pg_temp.assert_true((select count(*)=2 from garments_erp.job_assignees where production_id=p),'multiple assignees survive stage changes');
 perform pg_temp.assert_true(exists(select 1 from garments_erp.task_board_data_flag where task_board_data_id=b),'flags survive stage changes');
 -- Jump back more than one step. Both sewing attempts and packing are historical.
 r:=pg_temp.move(jsonb_build_object('action','rectify','production_id',p::text,'from_job_id',packing::text,'to_job_id',c1::text,'reason','Upstream correction'));
 perform pg_temp.assert_true(garments_erp.production_path(p)=array[c1],'multi-step rectification truncates route');
 begin
  perform pg_temp.move(jsonb_build_object('action','rectify','production_id',p::text,'from_job_id',c1::text,'to_job_id',s1::text,'reason','Wrong branch'));
  raise exception 'TEST: stale branch accepted';
 exception when raise_exception then if sqlerrm<>'Select an earlier job on the current path' then raise;end if;end;
 begin update garments_erp.job set latest=true where id=s1;raise exception 'TEST: multiple current jobs accepted';
 exception when unique_violation then null;end;
 begin insert into garments_erp.job_item_status_list(job_id) values(c1);raise exception 'TEST: duplicate status accepted';
 exception when unique_violation then null;end;
 begin update garments_erp.job_transition_log set reason='Overwrite' where production_id=p;raise exception 'TEST: mutable history';
 exception when raise_exception then if sqlerrm<>'Production transitions are immutable' then raise;end if;end;
 set constraints all immediate;
 perform pg_temp.assert_true(exists(select 1 from jsonb_array_elements(public.erp_production_snapshot()->'records') snapshot_row where snapshot_row.value->'item'->>'id'='990001'),'guarded snapshot links actual item/image source');
end $$;
-- Employee saves use the logged-in operator, including self-edits. Activation is
-- explicit and an ordinary edit cannot reactivate an inactive employee.
insert into garments_erp.contacts(id,company_name) values (900006,'Synthetic HR contact');
do $$declare payload jsonb; r jsonb; employee_key bigint; doc jsonb; rev text;begin
 payload:=jsonb_build_object('draft',jsonb_build_object('employee',jsonb_build_object('contacts_id','900006','contact_purpose_id','900001')));
 r:=public.erp_save_employee(payload,null);
 select id into employee_key from garments_erp.employee where id not in(900001,900002) order by id desc limit 1;
 perform pg_temp.assert_true((select is_active and is_verified and verified_by_employee_id=900001 and activated_by_employee_id=900001 from garments_erp.employee where id=employee_key),'new employee active and operator verified');
 perform public.erp_set_employee_active(employee_key,false,md5(garments_erp.employee_document(employee_key)::text));
 payload:=payload||jsonb_build_object('id',employee_key::text,'expected',md5(garments_erp.employee_document(employee_key)::text));
 perform public.erp_save_employee(payload,null);
 perform pg_temp.assert_true((select not is_active and is_verified and verified_by_employee_id=900001 from garments_erp.employee where id=employee_key),'ordinary edit preserves inactive state');
 payload:=jsonb_build_object('id','900001','expected',md5(garments_erp.employee_document(900001)::text),
   'draft',jsonb_build_object('employee',jsonb_build_object('contacts_id','900001','contact_purpose_id','900001')));
 perform public.erp_save_employee(payload,null);
 perform pg_temp.assert_true((select verified_by_employee_id=900001 and is_verified from garments_erp.employee where id=900001),'self verification allowed');
end $$;
-- Verify real browser-role denial and self-deactivation, rather than relying
-- only on catalog grants or running the commands as the fixture owner.
-- Keep a second eligible Administrator for the self-deactivation scenario.
insert into garments_access.app_user_role(user_id,role_id)
select '00000000-0000-4000-8000-000000000002',id from garments_access.app_role where key='ci_admin';
set local role authenticated;
do $$declare r jsonb; own_record jsonb;begin
 begin
  perform 1 from garments_erp.production;
  raise exception 'TEST: direct browser production access allowed';
 exception when insufficient_privilege then null;end;
 r:=public.erp_employee_snapshot();
 select value into own_record from jsonb_array_elements(r->'records') where value->'employee'->>'id'='900001';
 perform public.erp_set_employee_active(900001,false,own_record->>'revision');
 if (public.erp_account_security()->>'enabled')::boolean or (public.erp_account_security()->>'ready')::boolean
  then raise exception 'TEST: inactive employee retained portal access';end if;
 begin
  perform public.erp_employee_snapshot();
  raise exception 'TEST: inactive employee retained HR access';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
-- No changes to production, Auth sessions or synthetic business data survive.
rollback;
