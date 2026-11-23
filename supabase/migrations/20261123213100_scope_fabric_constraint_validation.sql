-- Scope requirement/link validation and defer the document graph until complete.
-- Preserve receipt + output-batch atomicity after another command in the same transaction.
begin;
CREATE OR REPLACE FUNCTION garments_erp.save_fabric_requirement(p_requirement bigint, p_variant bigint, p_expected jsonb, p_values jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare actual jsonb; fields text[]:=array['fabric_type_id','sub_part_list_id','sub_part_name','lab_dip_id','consumption_per_piece_kg','item_part_fabric_status_id']; incoming garments_erp.item_part_fabric;
begin
 if auth.uid() is null or not garments_access.has_screen_permission('productionItems','edit')
  or not garments_access.has_screen_permission('programs','view') then raise exception 'Fabric planner edit permission required' using errcode='42501';end if;
 perform 1 from garments_erp.variant_item where id=p_variant for update;
 if not found then raise exception 'Select an existing variant part' using errcode='23503';end if;
 if p_requirement is not null then
  select garments_erp.fabric_json('item_part_fabric',to_jsonb(f)) into actual from garments_erp.item_part_fabric f where id=p_requirement and variant_item_id=p_variant for update;
  if actual is null or actual is distinct from p_expected then raise exception 'Fabric requirement changed. Reload before saving.' using errcode='40001';end if;
 elsif p_expected is not null and p_expected<>'null'::jsonb then raise exception 'New requirement cannot have an existing revision';end if;
 if p_values is null or p_values='null'::jsonb then
  delete from garments_erp.item_part_fabric where id=p_requirement;
 else
  if jsonb_typeof(p_values)<>'object' or exists(select 1 from jsonb_object_keys(p_values) k where not k=any(fields)) then raise exception 'Invalid component fields';end if;
  incoming:=jsonb_populate_record(null::garments_erp.item_part_fabric,p_values);
  if p_requirement is null then
   insert into garments_erp.item_part_fabric(variant_item_id,fabric_type_id,sub_part_list_id,sub_part_name,lab_dip_id,consumption_per_piece_kg,item_part_fabric_status_id)
   values(p_variant,incoming.fabric_type_id,incoming.sub_part_list_id,incoming.sub_part_name,incoming.lab_dip_id,incoming.consumption_per_piece_kg,incoming.item_part_fabric_status_id);
  else
   update garments_erp.item_part_fabric set fabric_type_id=incoming.fabric_type_id,sub_part_list_id=incoming.sub_part_list_id,
    sub_part_name=incoming.sub_part_name,lab_dip_id=incoming.lab_dip_id,consumption_per_piece_kg=incoming.consumption_per_piece_kg,
    item_part_fabric_status_id=incoming.item_part_fabric_status_id where id=p_requirement;
  end if;
 end if;
 -- Deferred integrity checks must finish inside the owning command, before returning
 -- to an authenticated caller that deliberately has no private table grants.
 set constraints garments_erp.check_lab_dip_traceability, garments_erp.check_fabric_plan_dyeing_links immediate;
 set constraints garments_erp.check_lab_dip_traceability deferred;
 return garments_erp.fabric_planner_snapshot();
end $$;

CREATE OR REPLACE FUNCTION garments_erp.set_fabric_plan_dyeing_link(p_requirement bigint, p_program_item bigint, p_linked boolean, p_screen text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if auth.uid() is null or p_screen is null or p_screen not in ('productionItems', 'programs')
      or not garments_access.has_screen_permission(p_screen, 'edit')
      or not garments_access.has_screen_permission('productionItems', 'view')
      or not garments_access.has_screen_permission('programs', 'view') then
    raise exception 'Fabric planner link permission required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(741208531);
  if p_linked then
    insert into garments_erp.fabric_plan_dyeing_link(item_part_fabric_id, dyeing_program_item_id)
      values (p_requirement, p_program_item) on conflict do nothing;
  else
    delete from garments_erp.fabric_plan_dyeing_link
      where item_part_fabric_id = p_requirement and dyeing_program_item_id = p_program_item;
  end if;
  set constraints garments_erp.check_lab_dip_traceability, garments_erp.check_fabric_plan_dyeing_links immediate;
 set constraints garments_erp.check_lab_dip_traceability deferred;
  return garments_erp.fabric_planner_snapshot();
end $$;

CREATE OR REPLACE FUNCTION garments_erp.save_fabric_document_core(p_resource text, p_root jsonb, p_action text, p_changes jsonb, p_verifier bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare contract jsonb:=garments_erp.fabric_contract(); root_table text:=p_root->>'table'; root_id text:=p_root->>'id'; original_root text:=p_root->>'id'; change jsonb; t text; rid text; vals jsonb; oldrow jsonb; actual jsonb; fields jsonb; col text; columns_sql text; select_sql text; assignments text; created_id text; mapped jsonb:='{}'; entry record; delete_pass boolean; root_expected jsonb:=p_root->'before'; root_actual jsonb; permitted_roots text[]; changed_dyed text[]; changed_program text[]; review jsonb; review_job bigint; review_changed boolean; link_changes jsonb; link_item bigint; link_requirement bigint; link_actual jsonb; linked_total numeric; reviewed_total numeric;
begin
 if p_action not in ('create','edit') or not (contract ? p_resource) or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>500 or jsonb_array_length(p_changes)=0 then raise exception 'Invalid Fabric command';end if;
 if not garments_access.has_screen_permission(p_resource,p_action) then raise exception 'This account cannot save this record' using errcode='42501';end if;
 permitted_roots:=case p_resource when 'suppliers' then array['yarn_supplier','knitter','dyer'] when 'labDips' then array['lab_dip'] when 'orders' then array['yarn_purchase_order'] when 'yarn' then array['yarn_bill'] when 'knitting' then array['knitting_bill'] when 'programs' then array['dyeing_program'] when 'dyeBills' then array['dyed_fabric_bill'] else array(select jsonb_object_keys(contract->p_resource)) end;
 if not root_table=any(permitted_roots) or root_id is null then raise exception 'Invalid document scope';end if;
 -- All portal Fabric writers serialize; source-balance checks and multi-row writes are atomic.
 perform pg_catalog.pg_advisory_xact_lock(741208531);
 -- Each document is atomic even when a previous command in the transaction
 -- completed its checks. Receipt and output-batch rows are inserted together.
 set constraints all deferred;
 if p_action='edit' then
  if root_id!~'^[0-9]+$' then raise exception 'Invalid record identity';end if;
  execute format('select to_jsonb(x) from garments_erp.%I x where id=$1::bigint for update',root_table) into root_actual using root_id;
  if root_actual is null or garments_erp.fabric_json(root_table,root_actual) is distinct from root_expected then raise exception 'This document changed. Reload and review it again.' using errcode='40001';end if;
 elsif root_id!~'^[0-9a-f-]{36}$' then raise exception 'New records require a temporary identity';end if;
 if exists(select 1 from jsonb_array_elements(p_changes) c where jsonb_typeof(c)<>'object' or not (c ?& array['table','id','before','values']) or c->>'id' is null or c->>'table' is null) then raise exception 'Malformed document change';end if;

 -- Composite planner identities are handled explicitly, never as a synthetic row ID.
 select coalesce(jsonb_agg(c),'[]') into link_changes from jsonb_array_elements(p_changes) c where c->>'table'='fabric_plan_dyeing_link';
 if jsonb_array_length(link_changes)>0 then
  if p_resource<>'programs' or not garments_access.has_screen_permission('productionItems','view') then
   raise exception 'Planner links require program save and item view access' using errcode='42501';end if;
  for change in select value from jsonb_array_elements(link_changes) loop
   if change->'before'<>'null'::jsonb then
    link_item:=(change->'before'->>'dyeing_program_item_id')::bigint;
    link_requirement:=(change->'before'->>'item_part_fabric_id')::bigint;
    if not exists(select 1 from garments_erp.dyeing_program_item i where i.id=link_item and i.dyeing_program_id::text=root_id) then raise exception 'Planner link belongs to another document';end if;
    select jsonb_build_object('item_part_fabric_id',l.item_part_fabric_id::text,'dyeing_program_item_id',l.dyeing_program_item_id::text) into link_actual
     from garments_erp.fabric_plan_dyeing_link l where l.item_part_fabric_id=link_requirement and l.dyeing_program_item_id=link_item for update;
    if link_actual is distinct from change->'before' then raise exception 'Planner links changed; reload and review again' using errcode='40001';end if;
    if change->'values'<>'null'::jsonb then raise exception 'Remove and add planner links explicitly';end if;
    delete from garments_erp.fabric_plan_dyeing_link where item_part_fabric_id=link_requirement and dyeing_program_item_id=link_item;
   elsif change->'values'='null'::jsonb then raise exception 'Invalid planner link change';end if;
  end loop;
 end if;
 -- Updates/inserts in client contract dependency order. Deletes run in reverse afterwards.
 foreach delete_pass in array array[false,true] loop
 for change in select value from jsonb_array_elements(p_changes) with ordinality c(value,n) where value->>'table'<>'fabric_plan_dyeing_link' and (value->'values'='null'::jsonb)=delete_pass order by case when delete_pass then -n else n end loop
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
  review:=null;review_changed:=false;
  if t='lab_dip_version' and not delete_pass then
   review:=jsonb_build_object('date',vals->'date','comments',vals->'comments','lab_dip_status_id',vals->'lab_dip_status_id');
   review_changed:=oldrow='null'::jsonb or row(oldrow->'date',oldrow->'comments',oldrow->'lab_dip_status_id')
     is distinct from row(review->'date',review->'comments',review->'lab_dip_status_id');
   vals:=vals-array['date','comments','lab_dip_status_id'];
  end if;
  if oldrow<>'null'::jsonb then
   if rid!~'^[0-9]+$' then raise exception 'Invalid existing identity';end if;
   execute format('select to_jsonb(x) from garments_erp.%I x where id=$1::bigint for update',t) into actual using rid;
   if actual is null or garments_erp.fabric_json(t,actual) is distinct from oldrow then raise exception 'A linked record changed. Reload and review again.' using errcode='40001';end if;
   if not garments_erp.fabric_row_in_document(t,actual,root_table,root_id) then raise exception 'Record belongs to another document';end if;
   if t='contacts' then raise exception 'Edit existing shared company details from Contacts';end if;
   if delete_pass then
    if t=root_table or t=any(array['contacts','lab_dip','lab_dip_version']) then raise exception 'This record cannot be removed here';end if;
    execute format('delete from garments_erp.%I where id=$1::bigint',t) using rid;
   else
    if not garments_erp.fabric_row_in_document(t,vals||jsonb_build_object('id',rid),root_table,root_id) then raise exception 'Cannot move a row between documents';end if;
    select string_agg(format('%I=v.%I',key,key),',') into assignments from jsonb_object_keys(vals) key;
    execute format('update garments_erp.%I x set %s from jsonb_populate_record(null::garments_erp.%I,$1) v where x.id=$2::bigint',t,assignments,t) using vals,rid;
   end if;
  else
   if mapped ? rid then raise exception 'Duplicate temporary identity';end if;
   if delete_pass or rid!~'^[0-9a-f-]{36}$' then raise exception 'Invalid new record';end if;
   if not garments_erp.fabric_row_in_document(t,vals||jsonb_build_object('id',rid),root_table,case when t=root_table then original_root else root_id end) then raise exception 'New row is outside the document';end if;
   select string_agg(format('%I',key),','),string_agg(format('v.%I',key),',') into columns_sql,select_sql from jsonb_object_keys(vals) key;
   execute format('insert into garments_erp.%I (%s) select %s from jsonb_populate_record(null::garments_erp.%I,$1) v returning id::text',t,columns_sql,select_sql,t) into created_id using vals;
   mapped:=mapped||jsonb_build_object(rid,created_id);if t=root_table then root_id:=created_id;end if;
  end if;
  if review_changed then
   review_job:=coalesce(mapped->>rid,rid)::bigint;
   insert into garments_erp.lab_dip_version_item(lab_dip_version_id,date,comments,lab_dip_status_id)
   values(review_job,(review->>'date')::date,review->>'comments',(review->>'lab_dip_status_id')::bigint);
  end if;
 end loop;
 end loop;

 for change in select value from jsonb_array_elements(link_changes) where value->'before'='null'::jsonb loop
  vals:=change->'values';
  if jsonb_typeof(vals)<>'object' or not (vals ?& array['item_part_fabric_id','dyeing_program_item_id']) or
   exists(select 1 from jsonb_object_keys(vals) k where k not in ('item_part_fabric_id','dyeing_program_item_id')) then raise exception 'Invalid planner link fields';end if;
  link_item:=coalesce(mapped->>(vals->>'dyeing_program_item_id'),vals->>'dyeing_program_item_id')::bigint;
  link_requirement:=(vals->>'item_part_fabric_id')::bigint;
  if not exists(select 1 from garments_erp.dyeing_program_item i where i.id=link_item and i.dyeing_program_id::text=root_id) then raise exception 'Planner link belongs to another document';end if;
  insert into garments_erp.fabric_plan_dyeing_link(item_part_fabric_id,dyeing_program_item_id) values(link_requirement,link_item);
 end loop;
 -- Adding links replaces only the affected item's ordered kg from its complete linked set.
 for link_item in select distinct coalesce(mapped->>(c->'values'->>'dyeing_program_item_id'),c->'values'->>'dyeing_program_item_id')::bigint
  from jsonb_array_elements(link_changes) c where c->'before'='null'::jsonb loop
  select round(coalesce(sum(r.required_kg),0),3) into linked_total
   from garments_erp.fabric_plan_dyeing_link l join garments_erp.fabric_plan_requirements r on r.id=l.item_part_fabric_id
   where l.dyeing_program_item_id=link_item;
  select (c->>'reviewed_required_kg')::numeric into reviewed_total from jsonb_array_elements(link_changes) c
   where c->'before'='null'::jsonb and coalesce(mapped->>(c->'values'->>'dyeing_program_item_id'),c->'values'->>'dyeing_program_item_id')::bigint=link_item limit 1;
  if reviewed_total is null then
   update garments_erp.dyeing_program_item set quantity=linked_total where id=link_item;
  elsif reviewed_total is distinct from linked_total then
   raise exception 'Planner quantities changed. Reload and reconfirm the complete links.' using errcode='40001';
  end if;
  -- A reviewed total validates the recalculation; the entered item quantity may be a subsequent manual override.

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
 if p_resource='dyeBills' then
  if p_verifier is null then raise exception 'Dyed bill password verification required' using errcode='42501';end if;
  update garments_erp.dyed_fabric_bill set verified_by_employee_id=p_verifier where id=root_id::bigint;
 end if;
 return garments_erp.fabric_snapshot() || jsonb_build_object('_saved_id', root_id);
end $_$;
commit;
