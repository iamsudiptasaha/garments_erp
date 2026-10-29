-- PROPOSED ONLY: requires a separately reviewed production database change.
-- Tests apply this exclusively to the isolated CI database.
begin;
do $$ declare r record;
begin
 for r in select c.oid,n.nspname,c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('garments_erp','garments_access') and c.relkind in ('r','p','v','S') loop
  if r.relkind in ('r','p') then execute format('alter table %I.%I enable row level security',r.nspname,r.relname);end if;
  execute format('revoke all on %I.%I from public,anon,authenticated',r.nspname,r.relname);
 end loop;
 for r in select p.oid,p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('garments_erp','garments_access') loop
  if has_function_privilege('service_role',r.oid,'EXECUTE') then execute format('grant execute on function %s to service_role',r.signature);end if;
  execute format('revoke all on function %s from public,anon,authenticated',r.signature);
 end loop;
 -- Authenticated users can execute only helpers reached by reviewed public ERP RPC wrappers.
 for r in select distinct p.oid::regprocedure signature from pg_proc wrapper join pg_namespace wn on wn.oid=wrapper.pronamespace cross join lateral regexp_matches(pg_get_functiondef(wrapper.oid),'garments_access\.([a-z_]+)\(','g') m join pg_proc p on p.proname=m[1] join pg_namespace n on n.oid=p.pronamespace where wn.nspname='public' and wrapper.proname like 'erp_%' and n.nspname='garments_access' loop
  execute format('grant execute on function %s to authenticated',r.signature);
 end loop;
end $$;
create or replace function garments_access.save_fabric_document(p_resource text,p_root jsonb,p_action text,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $body$
declare contract jsonb:=garments_access.fabric_contract(); root_table text:=p_root->>'table'; root_id text:=p_root->>'id'; original_root text:=p_root->>'id'; change jsonb; t text; rid text; vals jsonb; oldrow jsonb; actual jsonb; fields jsonb; col text; columns_sql text; select_sql text; assignments text; created_id text; mapped jsonb:='{}'; entry record; delete_pass boolean; root_expected jsonb:=p_root->'before'; root_actual jsonb; permitted_roots text[]; changed_dyed text[]; changed_program text[];
begin
 if p_action not in ('create','edit') or not (contract ? p_resource) or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>500 or jsonb_array_length(p_changes)=0 then raise exception 'Invalid Fabric command';end if;
 if not garments_access.has_screen_permission(p_resource,p_action) then raise exception 'This account cannot save this record' using errcode='42501';end if;
 permitted_roots:=case p_resource when 'suppliers' then array['yarn_supplier','knitter','dyer'] when 'labDips' then array['lab_dip'] when 'orders' then array['yarn_purchase_order'] when 'yarn' then array['yarn_bill'] when 'knitting' then array['knitting_bill'] when 'programs' then array['dyeing_program'] when 'dyeBills' then array['dyed_fabric_bill'] else array(select jsonb_object_keys(contract->p_resource)) end;
 if not root_table=any(permitted_roots) or root_id is null then raise exception 'Invalid document scope';end if;
 -- All portal Fabric writers serialize; source-balance checks and multi-row writes are atomic.
 perform pg_catalog.pg_advisory_xact_lock(741208531);
 if p_action='edit' then
  if root_id!~'^[0-9]+$' then raise exception 'Invalid record identity';end if;
  execute format('select to_jsonb(x) from garments_erp.%I x where id=$1::bigint for update',root_table) into root_actual using root_id;
  if root_actual is null or garments_access.fabric_json(root_table,root_actual) is distinct from root_expected then raise exception 'This document changed. Reload and review it again.' using errcode='40001';end if;
 elsif root_id!~'^[0-9a-f-]{36}$' then raise exception 'New records require a temporary identity';end if;
 if exists(select 1 from jsonb_array_elements(p_changes) c where jsonb_typeof(c)<>'object' or not (c ?& array['table','id','before','values']) or c->>'id' is null or c->>'table' is null) then raise exception 'Malformed document change';end if;
 -- Updates/inserts in client contract dependency order. Deletes run in reverse afterwards.
 foreach delete_pass in array array[false,true] loop
 for change in select value from jsonb_array_elements(p_changes) with ordinality c(value,n) where (value->'values'='null'::jsonb)=delete_pass order by case when delete_pass then -n else n end loop
  t:=change->>'table';rid:=change->>'id';oldrow:=change->'before';vals:=change->'values';fields:=contract->p_resource->t;
  if fields is null then raise exception 'Table is outside this screen';end if;
  if vals<>'null'::jsonb then
   if jsonb_typeof(vals)<>'object' or exists(select 1 from jsonb_object_keys(vals) k where not fields ? k) then raise exception 'Field is outside the writable contract';end if;
   for entry in select key,value from jsonb_each_text(vals) loop
    if mapped ? entry.value then vals:=jsonb_set(vals,array[entry.key],mapped->entry.value);end if;
   end loop;
   for entry in select e.key,e.value from jsonb_each_text(vals) e join information_schema.columns c on c.table_schema='garments_erp' and c.table_name=t and c.column_name=e.key where c.data_type in ('numeric','integer') and e.value is not null loop if entry.value::numeric<0 then raise exception 'Quantities, weights and rates cannot be negative';end if;end loop;
   if t='lab_dip_version' and coalesce((vals->>'attached_swatch')::boolean,false) then vals:=vals||jsonb_build_object('shade_card_no',null,'shade_card_option',null,'lab_dip_status_id',(select id::text from garments_erp.lab_dip_version_status where sort_order=4));end if;
  end if;
  if oldrow<>'null'::jsonb then
   if rid!~'^[0-9]+$' then raise exception 'Invalid existing identity';end if;
   execute format('select to_jsonb(x) from garments_erp.%I x where id=$1::bigint for update',t) into actual using rid;
   if actual is null or garments_access.fabric_json(t,actual) is distinct from oldrow then raise exception 'A linked record changed. Reload and review again.' using errcode='40001';end if;
   if not garments_access.fabric_row_in_document(t,actual,root_table,root_id) then raise exception 'Record belongs to another document';end if;
   if t='contacts' then raise exception 'Edit existing shared company details from Contacts';end if;
   if delete_pass then
    if t=root_table or t=any(array['contacts','lab_dip','lab_dip_version']) then raise exception 'This record cannot be removed here';end if;
    execute format('delete from garments_erp.%I where id=$1::bigint',t) using rid;
   else
    if not garments_access.fabric_row_in_document(t,vals||jsonb_build_object('id',rid),root_table,root_id) then raise exception 'Cannot move a row between documents';end if;
    select string_agg(format('%I=v.%I',key,key),',') into assignments from jsonb_object_keys(vals) key;
    execute format('update garments_erp.%I x set %s from jsonb_populate_record(null::garments_erp.%I,$1) v where x.id=$2::bigint',t,assignments,t) using vals,rid;
   end if;
  else
   if mapped ? rid then raise exception 'Duplicate temporary identity';end if;
   if delete_pass or rid!~'^[0-9a-f-]{36}$' then raise exception 'Invalid new record';end if;
   if not garments_access.fabric_row_in_document(t,vals||jsonb_build_object('id',rid),root_table,case when t=root_table then original_root else root_id end) then raise exception 'New row is outside the document';end if;
   select string_agg(format('%I',key),','),string_agg(format('v.%I',key),',') into columns_sql,select_sql from jsonb_object_keys(vals) key;
   execute format('insert into garments_erp.%I (%s) select %s from jsonb_populate_record(null::garments_erp.%I,$1) v returning id::text',t,columns_sql,select_sql,t) into created_id using vals;
   mapped:=mapped||jsonb_build_object(rid,created_id);if t=root_table then root_id:=created_id;end if;
  end if;
 end loop;
 end loop;
 if p_action='create' and not (mapped ? original_root) then raise exception 'The new document header is missing';end if;
 if p_resource='suppliers' then
  for change in select value from jsonb_array_elements(p_changes) where value->>'table'='contacts' loop
   if not exists(select 1 from jsonb_array_elements(p_changes) r where r->>'table'=root_table and r->'values'->>'contacts_id'=change->>'id') then raise exception 'New company must be assigned to this supplier';end if;
  end loop;
 end if;
 execute format('update garments_erp.%I set updated_at=clock_timestamp() where id=$1::bigint',root_table) using root_id;
 if root_table=any(array['yarn_purchase_order','yarn_bill','knitting_bill','dyeing_program','dyed_fabric_bill','lab_dip']) then
  t:=case root_table when 'yarn_purchase_order' then 'yarn_purchase_order_item' when 'yarn_bill' then 'yarn_bill_item' when 'knitting_bill' then 'knitting_bill_item' when 'dyeing_program' then 'dyeing_program_item' when 'dyed_fabric_bill' then 'dyed_fabric_item' else 'lab_dip_version' end;
  col:=case root_table when 'yarn_purchase_order' then 'purchase_order_number_id' else root_table||'_id' end;
  execute format('select to_jsonb(count(*)) from garments_erp.%I where %I=$1::bigint',t,col) into actual using root_id;
  if actual='0'::jsonb then raise exception 'A document must contain at least one line or version';end if;
 end if;
 -- Weight gain and shortage are allowed. Only source identity/type compatibility is checked.
 select coalesce(array_agg(distinct ref) filter(where ref is not null),array[]::text[]) into changed_dyed from (select coalesce(mapped->>(c->>'id'),c->>'id') ref from jsonb_array_elements(p_changes) c where c->>'table'='dyed_fabric_item' and c->'values'<>'null'::jsonb and exists(select 1 from unnest(array['billed_quantity','gross_quantity','final_quantity','knitting_bill_item_id','dyeing_program_item_id']) f where c->'before'->f is distinct from c->'values'->f)) q;
 select coalesce(array_agg(distinct ref) filter(where ref is not null),array[]::text[]) into changed_program from (select coalesce(mapped->>(c->>'id'),c->>'id') ref from jsonb_array_elements(p_changes) c where c->>'table'='dyeing_program_item' and c->'values'<>'null'::jsonb and exists(select 1 from unnest(array['fabric_type_id']) f where c->'before'->f is distinct from c->'values'->f)) q;
 if exists(select 1 from garments_erp.dyed_fabric_item d join garments_erp.dyeing_program_item p on p.id=d.dyeing_program_item_id join garments_erp.knitting_bill_item k on k.id=d.knitting_bill_item_id where (d.id::text=any(changed_dyed) or p.id::text=any(changed_program)) and p.fabric_type_id<>k.fabric_type_id) then raise exception 'The changed dyeing program fabric type does not match its knitted source.';end if;
 set constraints all immediate;
 insert into garments_access.app_activity_log(actor_user_id,app_resource_id,action,target_type,target_id,details)
 values(auth.uid(),(select id from garments_access.app_resource where key=p_resource),'Saved '||p_action||' document',root_table,root_id,jsonb_build_object('screen',p_resource,'changed_rows',jsonb_array_length(p_changes)));
 return garments_access.fabric_snapshot();
end $body$;
commit;
