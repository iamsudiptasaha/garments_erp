-- Disposable local fixtures; no production reads/writes.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2","session_id":"10000000-0000-4000-8000-000000000001"}',true);
insert into garments_erp.item(id,style_code) values(970002,'Workspace other item');
insert into garments_erp.part_list(id,part) values(970001,'Workspace body');
insert into garments_erp.size_list(id,size) values(970001,'Workspace size');
insert into garments_erp.variant(id,variant_name) values(970001,'Workspace shared');
insert into garments_erp.stage_type(id,name) values(970001,'Workspace type');
insert into garments_erp.stage(id,name,abbr,sort_order,stage_type_id) values(970001,'Workspace start','WST',-2147483602,970001);
insert into garments_erp.item_status_list(id,status) values(970001,'Workspace status');
set local role authenticated;
do $$
declare cmd jsonb;gid text;category text;snapshot jsonb;item jsonb;part jsonb;sz jsonb;root jsonb;changes jsonb;pid text;job_id text;rev text;checklist jsonb;temp_id text:='11111111-1111-4111-8111-111111111111';r jsonb;
begin
 if has_function_privilege('anon','public.erp_production_workspace()','execute') or has_table_privilege('authenticated','garments_erp.item','INSERT') then raise exception 'TEST: anonymous or direct table access exposed';end if;
 -- Exercise every live reference save boundary, including its generated identity.
 snapshot:=public.erp_save_production_setup('productionGenders',jsonb_build_object('table','gender','id',temp_id,'before',null),'create',jsonb_build_array(jsonb_build_object('table','gender','id',temp_id,'before',null,'values',jsonb_build_object('name','Workspace reference gender'))));
 select x->>'id' into gid from jsonb_array_elements(snapshot->'gender') x where x->>'name'='Workspace reference gender';
 select x->>'id' into category from jsonb_array_elements(snapshot->'contact_purpose') x limit 1;
 for cmd in select value from jsonb_array_elements(jsonb_build_array(
 jsonb_build_object('resource','productionWorkers','table','job_worker','values',jsonb_build_object('contacts_id','900001','contact_purpose_id',category)),
 jsonb_build_object('resource','productionDesigns','table','variant','values',jsonb_build_object('variant_name','Workspace reference variant','share_weight',1)),
 jsonb_build_object('resource','productionStages','table','stage','values',jsonb_build_object('name','Workspace reference stage','abbr','WRF','sort_order',2147483000,'stage_type_id','970001','track_pieces',false,'pp_stage',false)),
 jsonb_build_object('resource','productionStageTypes','table','stage_type','values',jsonb_build_object('name','Workspace reference type')),
 jsonb_build_object('resource','productionPartTypes','table','part_list','values',jsonb_build_object('part','Workspace reference part')),
 jsonb_build_object('resource','productionSizes','table','size_list','values',jsonb_build_object('size','Workspace reference size','sort_order',12345)),
 jsonb_build_object('resource','productionProductTypes','table','product_type_list','values',jsonb_build_object('product_type','Workspace reference product','gender_id',gid)),
 jsonb_build_object('resource','productionStatuses','table','item_status_list','values',jsonb_build_object('status','Workspace reference status')),
 jsonb_build_object('resource','productionFlags','table','flags_list','values',jsonb_build_object('name','Workspace reference flag')))) loop
 snapshot:=public.erp_save_production_setup(cmd->>'resource',jsonb_build_object('table',cmd->>'table','id',temp_id,'before',null),'create',jsonb_build_array(jsonb_build_object('table',cmd->>'table','id',temp_id,'before',null,'values',cmd->'values')));
 if not exists(select 1 from jsonb_array_elements(snapshot->(cmd->>'table')) x where x @> (cmd->'values') and jsonb_typeof(x->'id')='string') then raise exception 'TEST: reference command failed: %',cmd->>'resource';end if;
 end loop;
 root:=jsonb_build_object('table','item','id',temp_id,'before',null);
 changes:=jsonb_build_array(jsonb_build_object('table','item','id',temp_id,'before',null,'values',jsonb_build_object('style_code','WORKSPACE-TEST','batch_number','000123')),
 jsonb_build_object('table','item_part','id','22222222-2222-4222-8222-222222222222','before',null,'values',jsonb_build_object('item_id',temp_id,'part_list_id','970001')),
 jsonb_build_object('table','item_size_list','id','33333333-3333-4333-8333-333333333333','before',null,'values',jsonb_build_object('item_id',temp_id,'size_list_id','970001')),
 jsonb_build_object('table','item_cut_ratio','id','44444444-4444-4444-8444-444444444444','before',null,'values',jsonb_build_object('item_size_list_id','33333333-3333-4333-8333-333333333333','pieces',12)),
 jsonb_build_object('table','variant_item','id','55555555-5555-4555-8555-555555555555','before',null,'values',jsonb_build_object('item_part_id','22222222-2222-4222-8222-222222222222','variant_id','970001')));
 snapshot:=public.erp_save_production_setup('productionItems',root,'create',changes);
 select x into item from jsonb_array_elements(snapshot->'item') x where x->>'style_code'='WORKSPACE-TEST';
 if item->>'batch_number'<>'000123' or jsonb_typeof(item->'id')<>'string' then raise exception 'TEST: item or safe ID missing';end if;
 select x into part from jsonb_array_elements(snapshot->'item_part') x where x->>'item_id'=item->>'id';
 select x into sz from jsonb_array_elements(snapshot->'item_size_list') x where x->>'item_id'=item->>'id';
 if part is null or sz is null then raise exception 'TEST: temporary FK mapping failed';end if;
 root:=jsonb_build_object('table','item','id',item->>'id','before',item);
 changes:=jsonb_build_array(jsonb_build_object('table','item','id',item->>'id','before',item,'values',jsonb_build_object('batch_number','000456')));
 perform public.erp_save_production_setup('productionItems',root,'edit',changes);
 begin perform public.erp_save_production_setup('productionItems',root,'edit',changes);raise exception 'TEST: stale setup accepted';exception when serialization_failure then null;end;
 begin perform public.erp_save_production_setup('productionItems',root,'edit',jsonb_build_array(jsonb_build_object('table','variant','id','970001','before',null,'values','{"variant_name":"hijack"}'::jsonb)));raise exception 'TEST: linked variant edit accepted';exception when serialization_failure then null;end;
 -- A completely current root must still not authorize shared variant writes.
 snapshot:=public.erp_production_workspace();select x into item from jsonb_array_elements(snapshot->'item') x where x->>'style_code'='WORKSPACE-TEST';root:=root||jsonb_build_object('before',item);
 begin perform public.erp_save_production_setup('productionItems',root,'edit',jsonb_build_array(jsonb_build_object('table','variant','id','970001','before',null,'values','{"variant_name":"hijack"}'::jsonb)));raise exception 'TEST: linked variant edit accepted';exception when raise_exception then if sqlerrm<>'Row outside setup contract' then raise;end if;end;
 begin perform public.erp_save_production_setup('productionItems',root,'edit',jsonb_build_array(jsonb_build_object('table','item_size_list','id','66666666-6666-4666-8666-666666666666','before',null,'values',jsonb_build_object('item_id','970002','size_list_id','970001'))));raise exception 'TEST: cross-item child insertion accepted';exception when raise_exception then if sqlerrm<>'New row outside item' then raise;end if;end;
 -- Start and edit through actual public RPCs, with unchanged snapshot revision rejected.
 r:=public.erp_move_production(jsonb_build_object('action','start','item_part_id',part->>'id','to_stage_id','970001','verified_by','900001'),null);
 pid:=r->>'production_id';job_id:=r->>'job_id';
 snapshot:=public.erp_production_workspace();
 select x->>'revision' into rev from jsonb_array_elements(snapshot->'production_records') x where x->'production'->>'id'=pid;
 snapshot:=public.erp_edit_production_task(pid::bigint,rev,job_id::bigint,970001,null,array[900001::bigint],array[]::bigint[],'{"fpt_gpt_status_id":"970001"}',null);
 select x into checklist from jsonb_array_elements(snapshot->'production_checklist') x where x->>'item_id'=item->>'id';
 if not snapshot @> jsonb_build_object('production_job_counts',jsonb_build_array(jsonb_build_object('item_part_id',part->>'id','jobs',1))) then raise exception 'TEST: production-owned job count wrong';end if;
 if checklist->>'fpt_gpt_status_id'<>'970001' then raise exception 'TEST: checklist not persisted';end if;
 begin perform public.erp_edit_production_task(pid::bigint,rev,job_id::bigint,970001,null,array[]::bigint[],array[]::bigint[],'{}',checklist);raise exception 'TEST: stale task accepted';exception when serialization_failure then null;end;
 -- Failed status FK rolls back assignees, due date and checklist in the same command.
 select x->>'revision' into rev from jsonb_array_elements(snapshot->'production_records') x where x->'production'->>'id'=pid;
 begin perform public.erp_edit_production_task(pid::bigint,rev,job_id::bigint,-1,null,array[]::bigint[],array[]::bigint[],'{}',checklist);raise exception 'TEST: invalid status accepted';exception when foreign_key_violation then null;end;
 if not public.erp_production_workspace() @> jsonb_build_object('job_assignees',jsonb_build_array(jsonb_build_object('production_id',pid,'assigned_employees_id','900001'))) then raise exception 'TEST: failed edit partially saved';end if;
 -- No session and the unprivileged operator cannot read/write the workspace.
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","aal":"aal2","session_id":"10000000-0000-4000-8000-000000000002"}',true);
 begin perform public.erp_production_workspace();raise exception 'TEST: unauthorized read';exception when insufficient_privilege then null;end;
 begin perform public.erp_save_production_setup('productionItems',root,'edit',changes);raise exception 'TEST: unauthorized save';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into garments_access.app_role_resource_permission(app_role_id,app_resource_id,can_view)
select role.id,r.id,true from garments_access.app_role role,garments_access.app_resource r where role.key='ci_viewer' and r.key='productionJobs';
set local role authenticated;
do $$
declare task jsonb;prepared jsonb;
begin
 select x into task from jsonb_array_elements(public.erp_production_workspace()->'item') x where x->>'style_code'='WORKSPACE-TEST';
 if task is null then raise exception 'TEST: Production-only viewer cannot load tasks';end if;
 -- file_record is private: test its public list wrapper, without needing synthetic storage objects.
 perform public.erp_file_list('itemImage',(task->>'id')::bigint);
 begin perform public.erp_begin_file_upload('itemImage',(task->>'id')::bigint,'x.png','image/png',1);raise exception 'TEST: task viewer can upload item files';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$
declare
  assignment_id bigint;
  size_id bigint;
  pieces_header bigint;
  repeat_header bigint;
  pieces_line bigint;
  repeat_line bigint;
  sibling_line bigint;
  bill_one bigint;
  bill_two bigint;
  other_size bigint;
begin
  insert into garments_erp.variant_item_per_job(job_id, variant_item_id)
  select job.id, variant.id
  from garments_erp.item item
  join garments_erp.item_part part on part.item_id = item.id
  join garments_erp.production prod on prod.item_part_id = part.id
  join garments_erp.job job on job.production_id = prod.id
  join garments_erp.variant_item variant on variant.item_part_id = part.id
  where item.style_code = 'WORKSPACE-TEST'
  on conflict (job_id, variant_item_id) do nothing;

  select link.id, sz.id into strict assignment_id, size_id
  from garments_erp.item item
  join garments_erp.item_part part on part.item_id = item.id
  join garments_erp.production prod on prod.item_part_id = part.id
  join garments_erp.job job on job.production_id = prod.id
  join garments_erp.variant_item variant on variant.item_part_id = part.id
  join garments_erp.variant_item_per_job link on link.job_id = job.id and link.variant_item_id = variant.id
  join garments_erp.item_size_list sz on sz.item_id = item.id
  where item.style_code = 'WORKSPACE-TEST';

  update garments_erp.stage set track_pieces = true, pp_stage = false where id = 970001;
  insert into garments_erp.item_size_list(item_id, size_list_id)
  select item.id, size.id from garments_erp.item item, garments_erp.size_list size
  where item.style_code = 'WORKSPACE-TEST' and size.size = 'Workspace reference size'
  returning id into other_size;
  insert into garments_erp.stage_pieces(variant_item_per_job_id,item_size_list_id,pieces_stock_in)
    values (assignment_id,size_id,25),(assignment_id,other_size,8);

  set constraints garments_erp.check_challan_stock_in deferred;
  insert into garments_erp.challan(challan_number) values ('CI-PIECES')
    returning id into pieces_header;
  insert into garments_erp.challan(challan_number) values ('CI-REPEAT')
    returning id into repeat_header;
  insert into garments_erp.challan_job_item(challan_id, variant_item_per_job_id, rate)
    values (pieces_header, assignment_id, 100) returning id into pieces_line;
  insert into garments_erp.challan_job_item(challan_id, variant_item_per_job_id, rate)
    values (pieces_header, assignment_id, 100) returning id into sibling_line;
  insert into garments_erp.challan_job_item(challan_id, variant_item_per_job_id, rate, description)
    values (repeat_header, assignment_id, 200, 'Repeated full issuance') returning id into repeat_line;
  insert into garments_erp.challan_job_item_pieces(challan_job_item_id, item_size_list_id, issued_pieces)
    select line_id, stock.item_size_list_id, stock.pieces_stock_in
    from unnest(array[pieces_line,sibling_line,repeat_line]) as lines(line_id)
    cross join garments_erp.stage_pieces stock where stock.variant_item_per_job_id = assignment_id;

  insert into garments_erp.job_worker_bill default values returning id into bill_one;
  insert into garments_erp.job_worker_bill default values returning id into bill_two;
  insert into garments_erp.job_worker_bill_items(challan_job_item_id, job_worker_bill_id, billed_rate)
    values (pieces_line, bill_one, 4), (repeat_line, bill_one, 2), (sibling_line, bill_two, 4);
  begin
    insert into garments_erp.job_worker_bill_items(challan_job_item_id, job_worker_bill_id, billed_rate)
      values (pieces_line, bill_two, 1);
    raise exception 'TEST: same challan line billed twice';
  exception when unique_violation then null;
  end;

  if (select reference_rate from garments_erp.item_costing_job_reference
      where variant_item_per_job_id = assignment_id) is distinct from 10::numeric then
    raise exception 'TEST: job costing must sum worker bill rates independently of challan rates';
  end if;
  set constraints all immediate;
  begin
    insert into garments_erp.challan_job_item_pieces(challan_job_item_id, item_size_list_id, issued_pieces)
      values (pieces_line, size_id, 1);
    raise exception 'TEST: duplicate challan size accepted';
  exception when unique_violation then null;
  end;
  begin
    update garments_erp.challan_job_item_pieces set issued_pieces = 24
      where challan_job_item_id = repeat_line and item_size_list_id = size_id;
    raise exception 'TEST: partial stock-in accepted';
  exception when check_violation then null;
  end;
  begin
    delete from garments_erp.challan_job_item_pieces
      where challan_job_item_id = repeat_line and item_size_list_id = other_size;
    raise exception 'TEST: missing size accepted';
  exception when check_violation then null;
  end;
  begin
    update garments_erp.challan_job_item_pieces set issued_pieces = 25.5
      where challan_job_item_id = repeat_line and item_size_list_id = size_id;
    raise exception 'TEST: fractional issuance accepted';
  exception when check_violation then null;
  end;
end $$;
rollback;
