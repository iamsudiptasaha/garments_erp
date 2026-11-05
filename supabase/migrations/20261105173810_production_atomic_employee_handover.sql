-- Reviewed MVP Production command. Local migration only; release through Actions.
begin;
set local lock_timeout = '10s';
-- Keep per-visit submitted outputs in immutable movement history. Existing
-- transitions remain unknown (NULL), rather than inventing historical quantities.
alter table garments_erp.job_transition_log add column handover_pieces jsonb
 check(handover_pieces is null or jsonb_typeof(handover_pieces)='array');
-- Remove the extra employee password path; it is not used by other modules.
revoke all on function garments_access.attest_production(uuid,bigint,jsonb),
 public.erp_production_attestation(uuid,bigint,jsonb) from public,anon,authenticated;
create or replace function garments_access.move_production(p_payload jsonb,p_proof uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare action text:=p_payload->>'action'; pid bigint; source garments_erp.job; dest bigint;
 target_stage garments_erp.stage; current_stage garments_erp.stage; verifier bigint; expected_visit bigint; actual_visit bigint; quantities jsonb; expected_count integer;
 path bigint[]; part bigint; handoff_source bigint; variant_count integer; item bigint;
 operation text:=case when action='start' then 'create' else 'edit' end;
begin
 -- A previous command in the same transaction may have flushed constraints.
 -- Allow the atomic switch to pass through zero current jobs, then validate
 -- again before returning from this guarded command.
 set constraints all deferred;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>1000000
   or action is null or action not in ('start','advance','rectify') or exists(select 1 from jsonb_object_keys(p_payload) k
     where not k=any(array['action','production_id','item_part_id','from_job_id','to_job_id','to_stage_id','start_date','due_date','job_worker_id','item_status_list_id','reason','verified_by','expected_transition_id','pieces']))
   then raise exception 'Invalid production command';end if;
 if not garments_access.has_screen_permission('productionJobs',operation)
   then raise exception 'Production write access required' using errcode='42501';end if;
 -- The selected employee is a recorded MVP attribution, not a password proof.
 -- Portal session/role authorization remains mandatory and supplies the actor.
 if p_proof is not null then raise exception 'Password proofs are no longer used for Production';end if;
 verifier := (p_payload->>'verified_by')::bigint;
 if verifier is null or not exists(select 1 from garments_erp.employee where id=verifier and is_active)
   then raise exception 'Select an active employee';end if;
 quantities := coalesce(p_payload->'pieces','[]'::jsonb);
 if jsonb_typeof(quantities)<>'array' or jsonb_array_length(quantities)>10000
   then raise exception 'Invalid handover quantities';end if;
 if action='start' then
  if jsonb_array_length(quantities)<>0 then raise exception 'Starting production does not submit output';end if;
  part:=(p_payload->>'item_part_id')::bigint;
  perform 1 from garments_erp.item_part where id=part for update;
  if not found then raise exception 'Select an existing item part';end if;
  insert into garments_erp.production(item_part_id) values(part) returning id into pid;
  insert into garments_erp.task_board_data(production_id) values(pid);
  select * into target_stage from garments_erp.stage order by sort_order limit 1;
  if target_stage.id is null or (p_payload->>'to_stage_id')::bigint is distinct from target_stage.id
    then raise exception 'Production must start at the first stage';end if;
 else
  pid:=(p_payload->>'production_id')::bigint;
  select item_part_id into part from garments_erp.production where id=pid for update;
  if not found then raise exception 'Production does not exist';end if;
  select * into source from garments_erp.job where production_id=pid and latest for update;
  if source.id is null or source.id is distinct from (p_payload->>'from_job_id')::bigint
    then raise exception 'Current job changed. Reload before moving production.' using errcode='40001';end if;
  -- Current job plus latest transition identifies a visit, even after Rectify
  -- reopens an original job. Replaying an old visit cannot hand it over twice.
  select coalesce(max(id),0) into actual_visit from garments_erp.job_transition_log where production_id=pid;
  expected_visit:=(p_payload->>'expected_transition_id')::bigint;
  if expected_visit is null or expected_visit<>actual_visit
    then raise exception 'Current visit changed. Reload before handing over.' using errcode='40001';end if;
  path:=garments_access.production_path(pid);
  select * into current_stage from garments_erp.stage where id=source.stage_id;
  if current_stage.track_pieces and not current_stage.pp_stage then
   -- Every current part variant x item size must be submitted exactly once.
   select ip.item_id into item from garments_erp.item_part ip where ip.id=part;
   select count(*) into expected_count from garments_erp.variant_item vi
    cross join garments_erp.item_size_list sz where vi.item_part_id=part and sz.item_id=item;
   if expected_count=0 or jsonb_array_length(quantities)<>expected_count then
    raise exception 'Fill pieces for every variant and size before handover';end if;
   if exists(select 1 from jsonb_array_elements(quantities) q
    where jsonb_typeof(q)<>'object' or (select count(*) from jsonb_object_keys(q))<>3
     or not q ?& array['variant_item_id','item_size_list_id','pieces_stock_out']
     or jsonb_typeof(q->'pieces_stock_out') is distinct from 'number'
     or (q->>'pieces_stock_out')::numeric<0
     or (q->>'pieces_stock_out')::numeric<>trunc((q->>'pieces_stock_out')::numeric)
     or (q->>'pieces_stock_out')::numeric>= 'Infinity'::numeric
     or not exists(select 1 from garments_erp.variant_item vi
      join garments_erp.variant_item_per_job vj on vj.variant_item_id=vi.id and vj.job_id=source.id
      join garments_erp.item_size_list sz on sz.id=(q->>'item_size_list_id')::bigint and sz.item_id=item
      join garments_erp.stage_pieces sp on sp.variant_item_per_job_id=vj.id and sp.item_size_list_id=sz.id
      where vi.id=(q->>'variant_item_id')::bigint and vi.item_part_id=part))
    or (select count(distinct ((q->>'variant_item_id')::bigint,(q->>'item_size_list_id')::bigint)) from jsonb_array_elements(quantities) q)<>expected_count
    then raise exception 'Fill valid whole pieces once for every linked variant and size';end if;
   update garments_erp.stage_pieces sp set pieces_stock_out=(q->>'pieces_stock_out')::numeric
    from jsonb_array_elements(quantities) q, garments_erp.variant_item_per_job vj
    where vj.job_id=source.id and vj.variant_item_id=(q->>'variant_item_id')::bigint
     and sp.variant_item_per_job_id=vj.id and sp.item_size_list_id=(q->>'item_size_list_id')::bigint;
  elsif jsonb_array_length(quantities)<>0 then
   raise exception 'This stage does not track pieces';
  end if;
  if action='rectify' then
   dest:=(p_payload->>'to_job_id')::bigint;
   if dest is null or dest=source.id or not dest=any(path)
     then raise exception 'Select an earlier job on the current path';end if;
   if nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'Rectification requires a reason';end if;
   update garments_erp.job set latest=false where id=source.id;
   update garments_erp.job set latest=true,complete_date=null where id=dest and production_id=pid;
  else
   select * into target_stage from garments_erp.stage where id=(p_payload->>'to_stage_id')::bigint and sort_order>current_stage.sort_order;
   if target_stage.id is null or target_stage.id is distinct from (p_payload->>'to_stage_id')::bigint
     then raise exception 'Select a later stage';end if;
   update garments_erp.job set latest=false,complete_date=coalesce(complete_date,current_date) where id=source.id;
  end if;
 end if;
 if action in ('start','advance') then
  insert into garments_erp.job(production_id,stage_id,job_code,start_date,due_date,job_worker_id,latest)
  values(pid,target_stage.id,garments_erp.generate_job_code(target_stage.id),
    coalesce((p_payload->>'start_date')::date,current_date),(p_payload->>'due_date')::date,
    (p_payload->>'job_worker_id')::bigint,true) returning id into dest;
  insert into garments_erp.job_item_status_list(job_id,date,item_status_list_id)
  values(dest,current_date,(p_payload->>'item_status_list_id')::bigint);
  insert into garments_erp.variant_item_per_job(job_id,variant_item_id)
  select dest,id from garments_erp.variant_item where item_part_id=part;
  if target_stage.track_pieces and not target_stage.pp_stage then
   select j.id into handoff_source from unnest(path) with ordinality route(jid,n)
   join garments_erp.job j on j.id=route.jid join garments_erp.stage s on s.id=j.stage_id
   where s.track_pieces and not s.pp_stage order by route.n desc limit 1;
   if handoff_source is not null then
    -- Only the actual source attempt supplies output; abandoned attempts are
    -- neither aggregated nor reused, and challans are never copied.
    insert into garments_erp.stage_pieces(variant_item_per_job_id,item_size_list_id,pieces_stock_in,pieces_stock_out)
    select nl.id,p.item_size_list_id,p.pieces_stock_out,0
    from garments_erp.variant_item_per_job oldlink join garments_erp.stage_pieces p on p.variant_item_per_job_id=oldlink.id
    join garments_erp.variant_item_per_job nl on nl.job_id=dest and nl.variant_item_id=oldlink.variant_item_id
    where oldlink.job_id=handoff_source;
   else
    -- First tracked stage: equal-share/largest-remainder allocation by variant
    -- ID, preserving each planned size total and the pilot share_weight=1 rule.
    select item_id into item from garments_erp.item_part where id=part;
    select count(*) into variant_count from garments_erp.variant_item_per_job where job_id=dest;
    if variant_count=0 then raise exception 'Tracked production requires at least one variant';end if;
    insert into garments_erp.stage_pieces(variant_item_per_job_id,item_size_list_id,pieces_stock_in,pieces_stock_out)
    select vl.id,sz.item_size_list_id,trunc(sz.pieces/variant_count)+case when vl.n<=mod(sz.pieces,variant_count) then 1 else 0 end,0
    from (select id,row_number() over(order by variant_item_id) n from garments_erp.variant_item_per_job where job_id=dest) vl
    cross join (select cr.item_size_list_id,cr.pieces from garments_erp.item_cut_ratio cr
      join garments_erp.item_size_list s on s.id=cr.item_size_list_id where s.item_id=item) sz;
   end if;
  end if;
 end if;
 if action<>'start' then
  insert into garments_erp.job_transition_log(production_id,from_job_id,to_job_id,action,verified_by,actor_user_id,reason,handover_pieces)
  values(pid,source.id,dest,action,verifier,auth.uid(),p_payload->>'reason',quantities);
 end if;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details)
 values(auth.uid(),'Production '||action,'production',pid::text,jsonb_build_object('job_id',dest::text,'verified_by',verifier::text));
 -- Validate while still inside the guarded owner context, as Fabric commands
 -- already do. Browser roles deliberately have no direct table privileges.
 set constraints all immediate;
 return jsonb_build_object('production_id',pid::text,'job_id',dest::text,'current_path',
   (select jsonb_agg(x::text order by n) from unnest(garments_access.production_path(pid)) with ordinality a(x,n)),
   'transition_id',(select coalesce(max(id),0)::text from garments_erp.job_transition_log where production_id=pid),
   'stale_job_ids',(select coalesce(jsonb_agg(j.id::text order by j.id),'[]') from garments_erp.job j
     where j.production_id=pid and not j.id=any(garments_access.production_path(pid))));
end $$;

-- Existing public signature is retained for clients, with p_proof = NULL.
-- No anonymous grants and no direct table writes are added.
revoke all on function garments_access.move_production(jsonb,uuid),
 public.erp_move_production(jsonb,uuid) from public,anon;
grant execute on function garments_access.move_production(jsonb,uuid),
 public.erp_move_production(jsonb,uuid) to authenticated;
commit;
