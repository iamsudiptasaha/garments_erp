-- Reviewed Production workspace boundary. Deploy through main's database Actions workflow only.
begin;
set local lock_timeout='10s';
-- Items select shared variants; only Variants owns variant metadata.
update garments_access.app_resource_table m set relation_type='lookup',can_create=false,can_edit=false,can_delete=false
from garments_access.app_resource r,garments_access.app_db_table t
where m.app_resource_id=r.id and m.app_db_table_id=t.id and r.key='productionItems' and t.schema_name='garments_erp' and t.table_name='variant';
create function garments_access.production_setup_contract() returns jsonb
language sql immutable set search_path='' as $$ select '{"productionItems": {"item": ["style_code", "brand_id", "story", "season", "product_type_list_id", "product_description", "base_price", "batch_number"], "item_part": ["item_id", "part_list_id"], "item_size_list": ["item_id", "size_list_id"], "item_cut_ratio": ["item_size_list_id", "pieces"], "variant_item": ["item_part_id", "variant_id", "lab_dip_id"], "production_checklist": ["item_id", "fpt_gpt_status_id", "photoshoot_sample_status_id", "shipment_sample_status_id", "techpack_aqcuired_status_id", "ordersheet_acquired_status_id"]}, "productionWorkers": {"job_worker": ["contacts_id", "contact_purpose_id"]}, "productionDesigns": {"variant": ["variant_name", "share_weight"]}, "productionStages": {"stage": ["name", "abbr", "sort_order", "stage_type_id", "track_pieces", "pp_stage"]}, "productionStageTypes": {"stage_type": ["name"]}, "productionPartTypes": {"part_list": ["part"]}, "productionSizes": {"size_list": ["size", "sort_order"]}, "productionProductTypes": {"product_type_list": ["product_type", "gender_id"]}, "productionStatuses": {"item_status_list": ["status"]}, "productionFlags": {"flags_list": ["name"]}, "productionGenders": {"gender": ["name"]}}'::jsonb $$;

-- Shared variants are selectors: Items cannot rename or mutate those records.
create function garments_access.production_row_owned(t text,r jsonb,root_table text,root_id text) returns boolean
language plpgsql stable set search_path='' as $$
begin
 if t=root_table then return r->>'id'=root_id;end if;
 if root_table<>'item' then return false;end if;
 if t in ('item_part','item_size_list','production_checklist') then return r->>'item_id'=root_id;end if;
 if t='item_cut_ratio' then return exists(select 1 from garments_erp.item_size_list s where s.id::text=r->>'item_size_list_id' and s.item_id::text=root_id);end if;
 if t='variant_item' then return exists(select 1 from garments_erp.item_part p where p.id::text=r->>'item_part_id' and p.item_id::text=root_id);end if;
 return false;
end $$;

create function garments_access.production_workspace() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='{}';t text;rows jsonb;keys text[]:=array(select jsonb_object_keys(garments_access.production_setup_contract())); jobs boolean:=garments_access.has_screen_permission('productionJobs','view');
begin
 if not jobs and not exists(select 1 from unnest(keys) k where garments_access.has_screen_permission(k,'view')) then raise exception 'Production access required' using errcode='42501';end if;
 -- Closed table allowlist plus current per-screen permission. No HR/contact documents or storage paths.
 for t in select distinct d.table_name from garments_access.app_db_table d
 join garments_access.app_resource_table m on m.app_db_table_id=d.id
 join garments_access.app_resource r on r.id=m.app_resource_id
 where d.schema_name='garments_erp' and r.key=any(keys) and m.can_view and garments_access.has_screen_permission(r.key,'view')
 and d.table_name=any(array['item','item_part','item_size_list','item_cut_ratio','variant','variant_item','production_checklist','part_list','size_list','stage','stage_type','product_type_list','gender','flags_list','job_worker','item_status_list','brand_list','contact_purpose','lab_dip','lab_dip_version','lab_dip_version_status','color_map','color_map_by_brand'])
 union select unnest(case when jobs then array['item','item_part','item_size_list','item_cut_ratio','variant','variant_item','production_checklist','part_list','size_list','stage','stage_type','item_status_list','flags_list','brand_list','job_worker','job','job_item_status_list','variant_item_per_job','stage_pieces','production','task_board_data','job_assignees','task_board_data_flag','job_transition_log'] else array[]::text[] end)
 loop
  execute format('select coalesce(jsonb_agg(garments_access.fabric_json(%L,to_jsonb(x)) order by x.id),''[]''::jsonb) from garments_erp.%I x',t,t) into rows;
  result:=result||jsonb_build_object(t,rows);
 end loop;
 -- Contacts only supply linked labels, never contact children or financial details.
 if jobs or garments_access.has_screen_permission('productionWorkers','view') then
 result:=result||jsonb_build_object('contacts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id::text,'company_name',c.company_name)),'[]') from garments_erp.contacts c where garments_access.has_screen_permission('productionWorkers','view') or exists(select 1 from garments_erp.job_worker w where w.contacts_id=c.id)));
 end if;
 if jobs then
 result:=result||jsonb_build_object('employee',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'name',c.company_name,'employee_code',e.employee_code,'is_active',true) order by e.id),'[]') from garments_erp.employee e join garments_erp.contacts c on c.id=e.contacts_id where e.is_active),
 'production_records',(garments_access.production_snapshot()->'records'));
 end if;
 if jobs or garments_access.has_screen_permission('productionItems','view') then
 result:=result||jsonb_build_object('production_job_counts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select p.item_part_id::text,item_count.jobs from garments_erp.production p cross join lateral (select count(*)::integer jobs from garments_erp.job j where j.production_id=p.id) item_count) x));
 end if;
 if jobs or garments_access.has_screen_permission('productionWorkers','view') then
 result:=result||jsonb_build_object('production_worker_counts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select job_worker_id::text,count(*)::integer jobs from garments_erp.job where job_worker_id is not null group by job_worker_id) x));
 end if;
 result:=result||jsonb_build_object('attachments',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id::text,'filename',a.filename,'mime_type',a.mime_type)),'[]') from garments_erp.attachments a where a.id::text in(select x->>'image_attachment' from jsonb_array_elements(coalesce(result->'item','[]')) x)),'_live',true);
 return result;
end $$;
create function public.erp_production_workspace() returns jsonb language sql stable security invoker set search_path='' as $$select garments_access.production_workspace()$$;

create or replace function garments_access.file_record(p_key text,p_id bigint,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t jsonb;row_data jsonb;
begin
 t:=garments_access.file_target(p_key);
 if not garments_access.has_screen_permission(t->>'resource',p_action) and not
  (p_key='itemImage' and p_action='view' and garments_access.has_screen_permission('productionJobs','view')
   and exists(select 1 from garments_erp.production p join garments_erp.item_part ip on ip.id=p.item_part_id where ip.item_id=p_id))
 then raise exception 'No permission for this attachment' using errcode='42501';end if;
 execute format('select to_jsonb(r) from garments_erp.%I r where id=$1',t->>'table') into row_data using p_id;
 if row_data is null then raise exception 'Save the record in Supabase before attaching a file';end if;
 return t||jsonb_build_object('current',row_data->(t->>'slot'));
end $$;
revoke all on function garments_access.file_record(text,bigint,text) from public,anon,authenticated;

create function garments_access.save_production_setup(p_resource text,p_root jsonb,p_action text,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare contract jsonb:=garments_access.production_setup_contract();root_table text;root_id text:=p_root->>'id';original_id text:=p_root->>'id';t text;rid text;vals jsonb;actual jsonb;oldrow jsonb;fields jsonb;c jsonb;entry record;mapped jsonb:='{}';created_id text;cols text;sels text;assignments text;deleting boolean;
begin
 if p_action is null or p_action not in ('create','edit') or not contract ? p_resource or jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 500 or pg_column_size(p_changes)>1000000 then raise exception 'Invalid Production setup command';end if;
 if not garments_access.has_screen_permission(p_resource,p_action) then raise exception 'Production setup permission required' using errcode='42501';end if;
 root_table:=case when p_resource='productionItems' then 'item' else (select jsonb_object_keys(contract->p_resource) limit 1) end;
 if p_root->>'table' is distinct from root_table or root_id is null then raise exception 'Invalid setup root';end if;
 perform pg_catalog.pg_advisory_xact_lock(741208532);
 if p_action='edit' then
  if root_id!~'^[0-9]+$' then raise exception 'Invalid identity';end if;
  execute format('select garments_access.fabric_json(%L,to_jsonb(x)) from garments_erp.%I x where id=$1::bigint for update',root_table,root_table) into actual using root_id;
  if actual is null or actual is distinct from p_root->'before' then raise exception 'Setup changed. Reload before saving.' using errcode='40001';end if;
 elsif root_id!~'^[0-9a-f-]{36}$' then raise exception 'New records require a temporary identity';end if;
 foreach deleting in array array[false,true] loop
 for c in select value from jsonb_array_elements(p_changes) with ordinality x(value,n) where (value->'values'='null'::jsonb)=deleting order by case when deleting then -n else n end loop
  t:=c->>'table';rid:=c->>'id';vals:=c->'values';oldrow:=c->'before';fields:=contract->p_resource->t;
  if fields is null or rid is null or not c ?& array['table','id','before','values'] then raise exception 'Row outside setup contract';end if;
  if not deleting then
   if jsonb_typeof(vals) is distinct from 'object' or vals='{}' or exists(select 1 from jsonb_object_keys(vals) k where not fields ? k) then raise exception 'Field outside setup contract';end if;
   for entry in select key,value from jsonb_each_text(vals) loop
    if mapped ? entry.value then vals:=jsonb_set(vals,array[entry.key],mapped->entry.value);end if;
   end loop;
   if t='item_cut_ratio' and ((vals->>'pieces')::numeric<0 or (vals->>'pieces')::numeric<>trunc((vals->>'pieces')::numeric) or (vals->>'pieces')::numeric>9007199254740991) then raise exception 'Enter whole non-negative planned pieces';end if;
  end if;
  if oldrow<>'null'::jsonb then
   if rid!~'^[0-9]+$' then raise exception 'Invalid existing identity';end if;
   execute format('select garments_access.fabric_json(%L,to_jsonb(x)) from garments_erp.%I x where id=$1::bigint for update',t,t) into actual using rid;
   if actual is null or actual is distinct from oldrow then raise exception 'Linked setup changed. Reload before saving.' using errcode='40001';end if;
   if not coalesce(garments_access.production_row_owned(t,actual,root_table,root_id),false) then raise exception 'Row belongs to another item';end if;
   if deleting then
    if t=root_table then raise exception 'Cannot delete setup root here';end if;
    execute format('delete from garments_erp.%I where id=$1::bigint',t) using rid;
   else
    if not coalesce(garments_access.production_row_owned(t,actual||vals,root_table,root_id),false) then raise exception 'Cannot reparent setup rows';end if;
    select string_agg(format('%I=v.%I',key,key),',') into assignments from jsonb_object_keys(vals) key;
    execute format('update garments_erp.%I x set %s from jsonb_populate_record(null::garments_erp.%I,$1) v where x.id=$2::bigint',t,assignments,t) using vals,rid;
   end if;
  else
   if deleting or rid!~'^[0-9a-f-]{36}$' or mapped ? rid then raise exception 'Invalid temporary identity';end if;
   if not coalesce(garments_access.production_row_owned(t,vals||jsonb_build_object('id',rid),root_table,case when t=root_table then original_id else root_id end),false) then raise exception 'New row outside item';end if;
   select string_agg(format('%I',key),','),string_agg(format('v.%I',key),',') into cols,sels from jsonb_object_keys(vals) key;
   execute format('insert into garments_erp.%I (%s) select %s from jsonb_populate_record(null::garments_erp.%I,$1) v returning id::text',t,cols,sels,t) into created_id using vals;
   mapped:=mapped||jsonb_build_object(rid,created_id);if t=root_table then root_id:=created_id;end if;
  end if;
 end loop;
 end loop;
 if p_action='create' and not mapped ? original_id then raise exception 'Missing new root';end if;
 set constraints all immediate;
 insert into garments_access.app_activity_log(actor_user_id,app_resource_id,action,target_type,target_id,details) values(auth.uid(),(select id from garments_access.app_resource where key=p_resource),'Saved '||p_action||' document',root_table,root_id,jsonb_build_object('screen',p_resource,'changed_rows',jsonb_array_length(p_changes)));
 return garments_access.production_workspace();
end $$;
create function public.erp_save_production_setup(p_resource text,p_root jsonb,p_action text,p_changes jsonb) returns jsonb language sql security invoker set search_path='' as $$ select garments_access.save_production_setup(p_resource,p_root,p_action,p_changes) $$;

-- A task edit is one transaction; checklist ownership stays on Item, not Production.
create function garments_access.edit_production_task(p_id bigint,p_expected text,p_job bigint,p_status bigint,p_due date,p_assignees bigint[],p_flags bigint[],p_checklist jsonb,p_expected_checklist jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_item bigint;actual jsonb;c garments_erp.production_checklist;
begin
 if not garments_access.has_screen_permission('productionJobs','edit') then raise exception 'Production write access required' using errcode='42501';end if;
 select ip.item_id into owner_item from garments_erp.production p join garments_erp.item_part ip on ip.id=p.item_part_id where p.id=p_id;
 perform 1 from garments_erp.item where id=owner_item for update;
 perform 1 from garments_erp.production where id=p_id for update;
 if owner_item is null or md5(garments_access.production_document(p_id)::text) is distinct from p_expected or not exists(select 1 from garments_erp.job where id=p_job and production_id=p_id and latest) then raise exception 'Task changed. Reload before saving.' using errcode='40001';end if;
 select garments_access.fabric_json('production_checklist',to_jsonb(x)) into actual from garments_erp.production_checklist x where x.item_id=owner_item for update;
 if actual is distinct from nullif(p_expected_checklist,'null') then raise exception 'Item checklist changed. Reload before saving.' using errcode='40001';end if;
 if jsonb_typeof(p_checklist) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_checklist) k where not k=any(array['fpt_gpt_status_id','photoshoot_sample_status_id','shipment_sample_status_id','techpack_aqcuired_status_id','ordersheet_acquired_status_id'])) then raise exception 'Invalid checklist';end if;
 if exists(select 1 from garments_erp.job where id=p_job and start_date>p_due) then raise exception 'Due date cannot be before the job started';end if;
 c:=jsonb_populate_record(null::garments_erp.production_checklist,p_checklist);
 perform garments_access.save_production_board(p_id,p_expected,p_assignees,p_flags);
 update garments_erp.job set due_date=p_due where id=p_job;
 update garments_erp.job_item_status_list set item_status_list_id=p_status where job_id=p_job;
 insert into garments_erp.production_checklist(item_id,fpt_gpt_status_id,photoshoot_sample_status_id,shipment_sample_status_id,techpack_aqcuired_status_id,ordersheet_acquired_status_id)
 values(owner_item,c.fpt_gpt_status_id,c.photoshoot_sample_status_id,c.shipment_sample_status_id,c.techpack_aqcuired_status_id,c.ordersheet_acquired_status_id)
 on conflict on constraint production_checklist_item_id_key do update set fpt_gpt_status_id=excluded.fpt_gpt_status_id,photoshoot_sample_status_id=excluded.photoshoot_sample_status_id,shipment_sample_status_id=excluded.shipment_sample_status_id,techpack_aqcuired_status_id=excluded.techpack_aqcuired_status_id,ordersheet_acquired_status_id=excluded.ordersheet_acquired_status_id;
 set constraints all immediate;
 return garments_access.production_workspace();
end $$;
create function public.erp_edit_production_task(p_id bigint,p_expected text,p_job bigint,p_status bigint,p_due date,p_assignees bigint[],p_flags bigint[],p_checklist jsonb,p_expected_checklist jsonb) returns jsonb language sql security invoker set search_path='' as $$ select garments_access.edit_production_task(p_id,p_expected,p_job,p_status,p_due,p_assignees,p_flags,p_checklist,p_expected_checklist) $$;
revoke all on function garments_access.production_setup_contract(),garments_access.production_row_owned(text,jsonb,text,text) from public,anon,authenticated;
revoke all on function garments_access.production_workspace(),public.erp_production_workspace(),garments_access.save_production_setup(text,jsonb,text,jsonb),public.erp_save_production_setup(text,jsonb,text,jsonb),garments_access.edit_production_task(bigint,text,bigint,bigint,date,bigint[],bigint[],jsonb,jsonb),public.erp_edit_production_task(bigint,text,bigint,bigint,date,bigint[],bigint[],jsonb,jsonb) from public,anon;
grant execute on function garments_access.production_workspace(),public.erp_production_workspace(),garments_access.save_production_setup(text,jsonb,text,jsonb),public.erp_save_production_setup(text,jsonb,text,jsonb),garments_access.edit_production_task(bigint,text,bigint,bigint,date,bigint[],bigint[],jsonb,jsonb),public.erp_edit_production_task(bigint,text,bigint,bigint,date,bigint[],bigint[],jsonb,jsonb) to authenticated;
commit;
