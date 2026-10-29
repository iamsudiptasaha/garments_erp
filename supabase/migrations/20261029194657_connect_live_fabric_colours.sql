begin;
-- Closed Fabric/Colours contract. No direct table grants and no caller-supplied SQL identifiers.
create or replace function garments_access.fabric_contract() returns jsonb language sql immutable set search_path='' as $body$ select '{"yarnTypes": {"yarn_type": ["name", "yarn_count"]}, "fabricTypes": {"fabric_type": ["name"]}, "brands": {"brand_list": ["brand", "contacts_id", "contact_purpose_id"]}, "colours": {"color_map": ["name", "pantone_code"]}, "colourMappings": {"color_map_by_brand": ["color_map_id", "brand_list_id"]}, "labDips": {"lab_dip": ["date", "edition", "color_map_by_brand_id", "dyer_id"], "lab_dip_version": ["lab_dip_id", "version", "date", "shade_card_no", "shade_card_option", "comments", "lab_dip_status_id", "attached_swatch"]}, "suppliers": {"contacts": ["company_name"], "yarn_supplier": ["contacts_id", "contact_purpose_id"], "knitter": ["contacts_id", "contact_purpose_id"], "dyer": ["contacts_id", "contact_purpose_id"]}, "orders": {"yarn_purchase_order": ["yarn_supplier_id"], "yarn_purchase_order_item": ["purchase_order_number_id", "yarn_type_id", "quantity", "rate"]}, "yarn": {"yarn_bill": ["invoice_number", "invoice_date"], "yarn_bill_item": ["yarn_bill_id", "yarn_purchase_order_item_id", "billed_quantity", "billed_rate", "billed_bags"]}, "knitting": {"knitting_bill": ["invoice_number", "invoice_date", "knitter_id"], "knitting_bill_item": ["knitting_bill_id", "yarn_bill_item_id", "fabric_type_id", "greige_gsm", "consumption", "billed_quantity", "billed_rate", "billed_rolls"]}, "programs": {"dyeing_program": ["date", "dyer_id"], "dyeing_program_item": ["dyeing_program_id", "fabric_type_id", "quantity", "lab_dip_version_id", "batch_no", "comments"]}, "dyeBills": {"dyed_fabric_bill": ["invoice_number", "invoice_date"], "dyed_fabric_item": ["dyed_fabric_bill_id", "dyeing_program_item_id", "knitting_bill_item_id", "gross_quantity", "billed_quantity", "final_quantity", "dyeing_rolls", "dyeing_rate"], "batch_no_lab_dip_version_map": ["dyed_fabric_item_id", "batch_no", "lab_dip_version_id"]}, "dyed": {}, "yarnLeft": {}, "greige": {}, "batches": {}}'::jsonb $body$;
revoke all on function garments_access.fabric_contract() from public,anon,authenticated;

create or replace function garments_access.fabric_json(p_table text,p_row jsonb) returns jsonb
language plpgsql stable set search_path='' as $body$
declare c record; result jsonb:=p_row;
begin
 for c in select a.attname from pg_catalog.pg_attribute a where a.attrelid=pg_catalog.to_regclass('garments_erp.'||p_table) and a.atttypid='pg_catalog.int8'::pg_catalog.regtype and a.attnum>0 and not a.attisdropped loop
  if result->c.attname is not null and result->c.attname<>'null'::jsonb then result:=jsonb_set(result,array[c.attname],to_jsonb(result->>c.attname));end if;
 end loop;
 return result;
end $body$;
revoke all on function garments_access.fabric_json(text,jsonb) from public,anon,authenticated;

create or replace function garments_access.fabric_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $body$
declare t text; rows jsonb; result jsonb:='{}'; fields text; keys text[]:=array(select jsonb_object_keys(garments_access.fabric_contract()));
begin
 if auth.uid() is null or not exists(select 1 from unnest(keys) k where garments_access.has_screen_permission(k,'view')) then raise exception 'Fabric access is not enabled' using errcode='42501';end if;
 for t in select distinct d.table_name from garments_access.app_db_table d join garments_access.app_resource_table rt on rt.app_db_table_id=d.id join garments_access.app_resource r on r.id=rt.app_resource_id where d.schema_name='garments_erp' and r.key=any(keys) and rt.can_view and garments_access.has_screen_permission(r.key,'view') and d.table_name=any(array['contacts','contact_purpose','brand_list','yarn_supplier','knitter','dyer','yarn_type','fabric_type','color_map','color_map_by_brand','lab_dip','lab_dip_version','lab_dip_version_status','fabric_status_list','yarn_purchase_order','yarn_purchase_order_item','yarn_bill','yarn_bill_item','knitting_bill','knitting_bill_item','dyeing_program','dyeing_program_item','dyed_fabric_bill','dyed_fabric_item','batch_no_lab_dip_version_map']) loop
  fields:=case when t='contacts' then 'jsonb_build_object(''id'',x.id::text,''company_name'',x.company_name,''updated_at'',x.updated_at)' else 'garments_access.fabric_json('||quote_literal(t)||',to_jsonb(x))' end;
  execute format('select coalesce(jsonb_agg(%s order by x.id),''[]''::jsonb) from garments_erp.%I x',fields,t) into rows;
  result:=jsonb_set(result,array[t],rows);
 end loop;
 -- Attachment metadata only for records already visible in this snapshot. Private paths stay private.
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id::text,'filename',a.filename,'mime_type',a.mime_type,'file_size',a.file_size)),'[]'::jsonb) into rows from garments_erp.attachments a where a.id::text in (
 select r->>'bill_attachment' from jsonb_array_elements(coalesce(result->'yarn_bill','[]')||coalesce(result->'knitting_bill','[]')||coalesce(result->'dyed_fabric_bill','[]')) r
 union select r->>'shade_card_image_attachment' from jsonb_array_elements(coalesce(result->'lab_dip_version','[]')) r);
 return result||jsonb_build_object('attachments',rows,'_live',true);
end $body$;
revoke all on function garments_access.fabric_snapshot() from public,anon,authenticated;

create or replace function public.erp_fabric_snapshot() returns jsonb language sql set search_path='' as $body$ select garments_access.fabric_snapshot() $body$;
revoke all on function public.erp_fabric_snapshot() from public,anon;
grant execute on function public.erp_fabric_snapshot() to authenticated;
grant execute on function garments_access.fabric_snapshot() to authenticated;

create or replace function garments_access.fabric_row_in_document(p_table text,p_row jsonb,p_root_table text,p_root_id text) returns boolean
language plpgsql stable security definer set search_path='' as $body$
begin
 if p_table=p_root_table then return p_row->>'id'=p_root_id;end if;
 if p_root_table='lab_dip' and p_table='lab_dip_version' then return p_row->>'lab_dip_id'=p_root_id;end if;
 if p_root_table='yarn_purchase_order' then return p_table='yarn_purchase_order_item' and p_row->>'purchase_order_number_id'=p_root_id;end if;
 if p_root_table='yarn_bill' then return p_table='yarn_bill_item' and p_row->>'yarn_bill_id'=p_root_id;end if;
 if p_root_table='knitting_bill' then return p_table='knitting_bill_item' and p_row->>'knitting_bill_id'=p_root_id;end if;
 if p_root_table='dyeing_program' then return p_table='dyeing_program_item' and p_row->>'dyeing_program_id'=p_root_id;end if;
 if p_root_table='dyed_fabric_bill' then
  if p_table='dyed_fabric_item' then return p_row->>'dyed_fabric_bill_id'=p_root_id;end if;
  if p_table='batch_no_lab_dip_version_map' then return exists(select 1 from garments_erp.dyed_fabric_item d where d.id::text=p_row->>'dyed_fabric_item_id' and d.dyed_fabric_bill_id::text=p_root_id);end if;
 end if;
 if p_root_table=any(array['yarn_supplier','knitter','dyer']) and p_table='contacts' then return true;end if;
 return false;
end $body$;
revoke all on function garments_access.fabric_row_in_document(text,jsonb,text,text) from public,anon,authenticated;

create or replace function garments_access.save_fabric_document(p_resource text,p_root jsonb,p_action text,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $body$
declare contract jsonb:=garments_access.fabric_contract(); root_table text:=p_root->>'table'; root_id text:=p_root->>'id'; original_root text:=p_root->>'id'; change jsonb; t text; rid text; vals jsonb; oldrow jsonb; actual jsonb; fields jsonb; col text; columns_sql text; select_sql text; assignments text; created_id text; mapped jsonb:='{}'; entry record; delete_pass boolean; root_expected jsonb:=p_root->'before'; root_actual jsonb; permitted_roots text[];
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
 -- Server-side source balances, including edits/removals, cannot trust browser totals.
 if exists(select 1 from garments_erp.yarn_bill_item y join garments_erp.knitting_bill_item k on k.yarn_bill_item_id=y.id group by y.id,y.billed_quantity having sum(k.consumption)>y.billed_quantity) then raise exception 'Knitting consumption exceeds source yarn';end if;
 if exists(select 1 from garments_erp.knitting_bill_item k join garments_erp.dyed_fabric_item d on d.knitting_bill_item_id=k.id group by k.id,k.billed_quantity having sum(d.gross_quantity)>k.billed_quantity) then raise exception 'Dyeing consumption exceeds source greige';end if;
 if exists(select 1 from garments_erp.knitting_bill_item where billed_quantity>consumption) or exists(select 1 from garments_erp.dyed_fabric_item where billed_quantity>gross_quantity or final_quantity>billed_quantity) then raise exception 'Output exceeds its source quantity';end if;
 if exists(select 1 from garments_erp.dyed_fabric_item d join garments_erp.dyeing_program_item p on p.id=d.dyeing_program_item_id join garments_erp.knitting_bill_item k on k.id=d.knitting_bill_item_id where p.fabric_type_id<>k.fabric_type_id) then raise exception 'Knitted source does not match program fabric type';end if;
 set constraints all immediate;
 return garments_access.fabric_snapshot();
end $body$;
revoke all on function garments_access.save_fabric_document(text,jsonb,text,jsonb) from public,anon,authenticated;
create or replace function public.erp_save_fabric_document(p_resource text,p_root jsonb,p_action text,p_changes jsonb) returns jsonb language sql set search_path='' as $body$ select garments_access.save_fabric_document(p_resource,p_root,p_action,p_changes) $body$;
revoke all on function public.erp_save_fabric_document(text,jsonb,text,jsonb) from public,anon;
grant execute on function public.erp_save_fabric_document(text,jsonb,text,jsonb) to authenticated;
grant execute on function garments_access.save_fabric_document(text,jsonb,text,jsonb) to authenticated;
commit;
