-- Disposable local database only; fixtures and outputs roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.check_ok(value boolean, message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'TEST: %',message;end if;end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
-- No recent password AMR. The portal operator's session still requires AAL2.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000001"}',true);
insert into garments_erp.stage_type(id,name) values(980001,'Atomic test');
insert into garments_erp.stage(id,name,abbr,sort_order,stage_type_id,track_pieces)
 values(980001,'Atomic cut','ACUT',-2147483600,980001,true),(980002,'Atomic sew','ASEW',-2147483590,980001,true),(980003,'Atomic pack','APAC',-2147483580,980001,true);
insert into garments_erp.item(id,style_code) values(980001,'Atomic style');
insert into garments_erp.part_list(id,part) values(980001,'Atomic body');
insert into garments_erp.item_part(id,item_id,part_list_id) values(980001,980001,980001);
insert into garments_erp.size_list(id,size) values(980001,'Atomic S'),(980002,'Atomic M');
insert into garments_erp.item_size_list(id,size_list_id,item_id) values(980001,980001,980001),(980002,980002,980001);
insert into garments_erp.item_cut_ratio(item_size_list_id,pieces) values(980001,10),(980002,12);
insert into garments_erp.variant(id,variant_name) values(980001,'Atomic blue'),(980002,'Atomic red');
insert into garments_erp.variant_item(id,item_part_id,variant_id) values(980001,980001,980001),(980002,980001,980002);
insert into garments_erp.stage(id,name,abbr,sort_order,stage_type_id,track_pieces)
 values(980004,'Atomic transit','ATRN',-2147483595,980001,false);
insert into garments_erp.part_list(id,part) values(980002,'Atomic sleeve');
insert into garments_erp.item_part(id,item_id,part_list_id) values(980002,980001,980002);
insert into garments_erp.variant_item(id,item_part_id,variant_id) values(980003,980002,980001);
set local role authenticated;
do $$
declare r jsonb; pid bigint; first_job bigint; last_job bigint; visit text; q jsonb; payload jsonb; old_payload jsonb; before_sum numeric;
begin
 perform pg_temp.check_ok(not has_function_privilege('anon','public.erp_move_production(jsonb,uuid)','execute'),'no anonymous writes');
 perform pg_temp.check_ok(not has_function_privilege('authenticated','public.erp_production_attestation(uuid,bigint,jsonb)','execute'),'obsolete password endpoint revoked');
 r:=public.erp_move_production('{"action":"start","item_part_id":"980001","to_stage_id":"980001","verified_by":"900002"}',null);
 pid:=(r->>'production_id')::bigint;first_job:=(r->>'job_id')::bigint;
 -- 4 cells: unequal outputs, including zero, must all be explicit.
 q:='[{"variant_item_id":"980001","item_size_list_id":"980001","pieces_stock_out":7},{"variant_item_id":"980001","item_size_list_id":"980002","pieces_stock_out":0},{"variant_item_id":"980002","item_size_list_id":"980001","pieces_stock_out":19},{"variant_item_id":"980002","item_size_list_id":"980002","pieces_stock_out":2}]';
 payload:=jsonb_build_object('action','advance','production_id',pid::text,'from_job_id',first_job::text,'to_stage_id','980003','verified_by','900002','expected_transition_id','0','pieces',q);
 begin perform public.erp_move_production(payload||jsonb_build_object('pieces',q-3),null);raise exception 'TEST: incomplete accepted';
 exception when raise_exception then if sqlerrm not like 'Fill pieces%' then raise;end if;end;
 begin perform public.erp_move_production(payload||jsonb_build_object('pieces',jsonb_set(q,'{0,pieces_stock_out}','null')),null);raise exception 'TEST: null accepted';
 exception when raise_exception then if sqlerrm not like 'Fill valid%' then raise;end if;end;
 begin perform public.erp_move_production(payload||jsonb_build_object('pieces',jsonb_set(q,'{0,pieces_stock_out}','1.5')),null);raise exception 'TEST: fraction accepted';
 exception when raise_exception then if sqlerrm not like 'Fill valid%' then raise;end if;end;
 begin perform public.erp_move_production(payload||jsonb_build_object('pieces',jsonb_set(q,'{0,pieces_stock_out}','-1')),null);raise exception 'TEST: negative accepted';
 exception when raise_exception then if sqlerrm not like 'Fill valid%' then raise;end if;end;
 begin perform public.erp_move_production(payload||jsonb_build_object('pieces',jsonb_set(q,'{3}',q->0)),null);raise exception 'TEST: duplicate accepted';
 exception when raise_exception then if sqlerrm not like 'Fill valid%' then raise;end if;end;
 begin perform public.erp_move_production(payload||'{"verified_by":"-1"}',null);raise exception 'TEST: unknown employee accepted';
 exception when raise_exception then if sqlerrm<>'Select an active employee' then raise;end if;end;
 begin perform public.erp_move_production(payload||'{"to_stage_id":"980001"}',null);raise exception 'TEST: same stage accepted';
 exception when raise_exception then if sqlerrm<>'Select a later stage' then raise;end if;end;
 old_payload:=payload;
 r:=public.erp_move_production(payload,null);last_job:=(r->>'job_id')::bigint;visit:=r->>'transition_id';
 begin perform public.erp_move_production(old_payload,null);raise exception 'TEST: duplicate handover accepted';
 exception when serialization_failure then null;end;
 -- Rectify reopens the original identity; all current variant outputs are required too.
 payload:=jsonb_build_object('action','rectify','production_id',pid::text,'from_job_id',last_job::text,'to_job_id',first_job::text,'reason','Check cut','verified_by','900002','expected_transition_id',visit,'pieces',q);
 r:=public.erp_move_production(payload,null);
 begin perform public.erp_move_production(old_payload,null);raise exception 'TEST: old visit replay accepted';
 exception when serialization_failure then null;end;
 -- Fresh visit is eligible once, despite using the original job ID.
 r:=public.erp_move_production(old_payload||jsonb_build_object('expected_transition_id',r->>'transition_id'),null);
 -- Reject an actor with no production permission even when they select an employee.
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000002"}',true);
 begin perform public.erp_move_production(old_payload,null);raise exception 'TEST: unauthorized actor accepted';
 exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000001"}',true);
-- Tracked -> untracked -> tracked keeps the last tracked output, never zeroes it.
do $$declare r jsonb; pid text; j text; visit text; q jsonb;begin
 r:=public.erp_move_production('{"action":"start","item_part_id":"980002","to_stage_id":"980001","verified_by":"900002"}',null);
 pid:=r->>'production_id';j:=r->>'job_id';
 q:='[{"variant_item_id":"980003","item_size_list_id":"980001","pieces_stock_out":3},{"variant_item_id":"980003","item_size_list_id":"980002","pieces_stock_out":0}]';
 r:=public.erp_move_production(jsonb_build_object('action','advance','production_id',pid,'from_job_id',j,'to_stage_id','980004','verified_by','900002','expected_transition_id','0','pieces',q),null);
 j:=r->>'job_id';visit:=r->>'transition_id';
 begin
  perform public.erp_move_production(jsonb_build_object('action','advance','production_id',pid,'from_job_id',j,'to_stage_id','980003','verified_by','900002','expected_transition_id',visit,'pieces',q),null);
  raise exception 'TEST: untracked outputs accepted';
 exception when raise_exception then if sqlerrm<>'This stage does not track pieces' then raise;end if;end;
 perform public.erp_move_production(jsonb_build_object('action','advance','production_id',pid,'from_job_id',j,'to_stage_id','980003','verified_by','900002','expected_transition_id',visit,'pieces','[]'::jsonb),null);
end $$;
reset role;
do $$declare pid bigint;begin
 select id into pid from garments_erp.production where item_part_id=980001;
 perform pg_temp.check_ok((select count(*)=3 from garments_erp.job where production_id=pid),'skip creates only destination; re-advance creates new attempt');
 perform pg_temp.check_ok(not exists(select 1 from garments_erp.job where production_id=pid and stage_id=980002),'skipped stage has no job');
 perform pg_temp.check_ok((select count(*)=3 from garments_erp.job_transition_log where production_id=pid and verified_by=900002 and jsonb_array_length(handover_pieces)=4),'employee and immutable complete outputs recorded for each visit');
 perform pg_temp.check_ok((select sum(p.pieces_stock_in)=28 from garments_erp.stage_pieces p join garments_erp.variant_item_per_job v on v.id=p.variant_item_per_job_id join garments_erp.job j on j.id=v.job_id where j.production_id=pid and j.latest),'destination incoming equals submitted source output');
end $$;
select pg_temp.check_ok((select sum(sp.pieces_stock_in)=3 from garments_erp.stage_pieces sp join garments_erp.variant_item_per_job v on v.id=sp.variant_item_per_job_id join garments_erp.job j on j.id=v.job_id join garments_erp.production p on p.id=j.production_id where p.item_part_id=980002 and j.latest),'untracked transit preserves last tracked output including zero');
select pg_temp.check_ok(not exists(select 1 from garments_erp.stage_pieces sp join garments_erp.variant_item_per_job v on v.id=sp.variant_item_per_job_id join garments_erp.job j on j.id=v.job_id where j.stage_id=980004),'untracked stage has no quantity rows');
rollback;
