-- Approved Fabric ER remediation. Hosted application requires separate release approval.
begin;
set local lock_timeout='10s';
lock table garments_erp.dyeing_program, garments_erp.dyeing_program_lab_dip,
 garments_erp.dyeing_program_item, garments_erp.dyed_fabric_item,
 garments_erp.batch_no_lab_dip_version_map, garments_erp.color_map_by_brand in share row exclusive mode;
alter table garments_erp.dyeing_program_lab_dip add column source_dyeing_program_id bigint;
-- Historical reuse is unknown; deliberately leave every existing source NULL.
alter table garments_erp.dyeing_program_lab_dip add constraint dyeing_group_reuse_source
 foreign key(source_dyeing_program_id,lab_dip_id)
 references garments_erp.dyeing_program_lab_dip(dyeing_program_id,lab_dip_id) deferrable initially deferred;
alter table garments_erp.dyeing_program_lab_dip add constraint dyeing_group_not_own_source
 check(source_dyeing_program_id is distinct from dyeing_program_id);
create index dyeing_group_reuse_source on garments_erp.dyeing_program_lab_dip(source_dyeing_program_id,lab_dip_id);

create function garments_erp.guard_fabric_provenance() returns trigger
language plpgsql set search_path='' as $$
begin
 -- Same lock as all Fabric document writers; direct writes cannot race recording.
 perform pg_catalog.pg_advisory_xact_lock(741208531);
 if tg_op='INSERT' then return new;end if;
 if tg_table_name='dyed_fabric_item' then
  if tg_op='DELETE' or (new.id,new.dyed_fabric_bill_id,new.dyeing_program_item_id) is distinct from (old.id,old.dyed_fabric_bill_id,old.dyeing_program_item_id)
  then raise exception 'Recorded receipt provenance is immutable; an authorized audited correction is required' using errcode='23514';end if;
 elsif tg_table_name='batch_no_lab_dip_version_map' then
  if tg_op='DELETE' or (new.id,new.dyed_fabric_item_id,new.lab_dip_version_id,new.batch_no)
    is distinct from (old.id,old.dyed_fabric_item_id,old.lab_dip_version_id,old.batch_no)
  then raise exception 'Recorded output batch provenance is immutable; an authorized audited correction is required' using errcode='23514';end if;
 elsif tg_table_name='dyeing_program_lab_dip' then
  if (tg_op='DELETE' or (new.id,new.dyeing_program_id,new.lab_dip_id,new.lab_dip_version_id)
    is distinct from (old.id,old.dyeing_program_id,old.lab_dip_id,old.lab_dip_version_id))
   and exists(select 1 from garments_erp.dyeing_program_item i join garments_erp.dyed_fabric_item d on d.dyeing_program_item_id=i.id where i.dyeing_program_lab_dip_id=old.id)
  then raise exception 'Recorded receipts lock the program edition and version' using errcode='23514';end if;
 elsif tg_table_name='dyeing_program_item' then
  if (tg_op='DELETE' or (new.id,new.dyeing_program_id,new.dyeing_program_lab_dip_id,new.fabric_type_id)
    is distinct from (old.id,old.dyeing_program_id,old.dyeing_program_lab_dip_id,old.fabric_type_id))
   and exists(select 1 from garments_erp.dyed_fabric_item d where d.dyeing_program_item_id=old.id)
  then raise exception 'Recorded receipts lock their originating program item' using errcode='23514';end if;
 elsif tg_table_name='color_map_by_brand' then
  if (tg_op='DELETE' or (new.id,new.color_map_id,new.brand_list_id) is distinct from (old.id,old.color_map_id,old.brand_list_id))
   and exists(select 1 from garments_erp.lab_dip l where l.color_map_by_brand_id=old.id)
  then raise exception 'A colour mapping used by a Lab Dip cannot be reassigned' using errcode='23514';end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function garments_erp.guard_fabric_provenance() from public,anon,authenticated;
create trigger guard_fabric_provenance before insert or update or delete on garments_erp.dyed_fabric_item for each row execute function garments_erp.guard_fabric_provenance();
create trigger guard_fabric_provenance before insert or update or delete on garments_erp.batch_no_lab_dip_version_map for each row execute function garments_erp.guard_fabric_provenance();
create trigger guard_fabric_provenance before insert or update or delete on garments_erp.dyeing_program_lab_dip for each row execute function garments_erp.guard_fabric_provenance();
create trigger guard_fabric_provenance before insert or update or delete on garments_erp.dyeing_program_item for each row execute function garments_erp.guard_fabric_provenance();
create trigger guard_fabric_provenance before insert or update or delete on garments_erp.color_map_by_brand for each row execute function garments_erp.guard_fabric_provenance();
create trigger guard_fabric_provenance before insert or update or delete on garments_erp.lab_dip for each row execute function garments_erp.guard_fabric_provenance();

create or replace function garments_erp.check_lab_dip_traceability() returns trigger
language plpgsql set search_path='' as $$
declare affected_program bigint; j jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
 -- Scope the high-volume program/group/item path. Other ownership changes keep
 -- the existing complete-graph checks. Global locking is intentionally retained.
 if tg_table_name='dyeing_program' then affected_program:=(j->>'id')::bigint;
 elsif tg_table_name in ('dyeing_program_lab_dip','dyeing_program_item') then affected_program:=(j->>'dyeing_program_id')::bigint;end if;
 if tg_op='UPDATE' and tg_table_name='dyeing_program_item' then
  if old.dyeing_program_id is distinct from new.dyeing_program_id then affected_program:=null;end if;
 end if;

 if exists(select 1 from garments_erp.dyeing_program_lab_dip where affected_program is null or dyeing_program_id=affected_program group by dyeing_program_id having count(*)>6) then raise exception 'A dyeing program permits at most six edition groups' using errcode='23514';end if;
 if exists(select 1 from garments_erp.dyed_fabric_item d left join garments_erp.batch_no_lab_dip_version_map b on b.dyed_fabric_item_id=d.id where b.id is null and (affected_program is null or exists(select 1 from garments_erp.dyeing_program_item i where i.id=d.dyeing_program_item_id and i.dyeing_program_id=affected_program))) then raise exception 'Every dyed-fabric item requires one batch mapping';end if;
 if exists(select 1 from garments_erp.batch_no_lab_dip_version_map b
  join garments_erp.dyed_fabric_item d on d.id=b.dyed_fabric_item_id
  join garments_erp.dyeing_program_item i on i.id=d.dyeing_program_item_id
  join garments_erp.dyeing_program_lab_dip g on g.id=i.dyeing_program_lab_dip_id
  where (affected_program is null or g.dyeing_program_id=affected_program) and g.lab_dip_version_id<>b.lab_dip_version_id)
 then raise exception 'Batch and originating program must reference the same lab-dip version';end if;
 if exists(select 1 from garments_erp.dyeing_program_lab_dip g
  join garments_erp.dyeing_program p on p.id=g.dyeing_program_id
  join garments_erp.lab_dip l on l.id=g.lab_dip_id where (affected_program is null or p.id=affected_program) and p.dyer_id is distinct from l.dyer_id)
 then raise exception 'Lab-dip dyer must match the program dyer';end if;
 if exists(select 1 from garments_erp.dyeing_program_lab_dip g
  join garments_erp.batch_no_lab_dip_version_map b on b.id=g.batch_no
  join garments_erp.lab_dip_version v on v.id=b.lab_dip_version_id where (affected_program is null or g.dyeing_program_id=affected_program) and v.lab_dip_id<>g.lab_dip_id)
 then raise exception 'Previous batch must use the same lab-dip edition';end if;
 if exists(select 1 from garments_erp.dyeing_program_lab_dip g
  join garments_erp.batch_no_lab_dip_version_map b on b.id=g.batch_no
  join garments_erp.dyed_fabric_item d on d.id=b.dyed_fabric_item_id
  join garments_erp.dyeing_program_item i on i.id=d.dyeing_program_item_id where (affected_program is null or g.dyeing_program_id=affected_program) and i.dyeing_program_id=g.dyeing_program_id)
 then raise exception 'A program cannot use its own output as a previous batch';end if;
 if exists(select 1 from garments_erp.item_part_fabric f
  join garments_erp.variant_item vi on vi.id=f.variant_item_id
  join garments_erp.item_part ip on ip.id=vi.item_part_id
  join garments_erp.item it on it.id=ip.item_id
  join garments_erp.lab_dip l on l.id=f.lab_dip_id
  join garments_erp.color_map_by_brand cm on cm.id=l.color_map_by_brand_id
  where affected_program is null and it.brand_id is distinct from cm.brand_list_id)
 then raise exception 'Selected fabric requirement lab dip must match the item brand';end if;
 if exists(select 1 from garments_erp.dyeing_program p where p.dyeing_program_status_id is distinct from 1
  and (affected_program is null or p.id=affected_program)
  and (not exists(select 1 from garments_erp.dyeing_program_lab_dip g where g.dyeing_program_id=p.id)
   or exists(select 1 from garments_erp.dyeing_program_lab_dip g where g.dyeing_program_id=p.id
    and not exists(select 1 from garments_erp.dyeing_program_item i where i.dyeing_program_lab_dip_id=g.id))))
 then raise exception 'Final programs require a fabric item in every edition group' using errcode='23514';end if;
 if exists(with recursive reuse as (
   select g.dyeing_program_id origin,g.lab_dip_id,g.source_dyeing_program_id source,array[g.dyeing_program_id] path,false cycle
   from garments_erp.dyeing_program_lab_dip g where g.source_dyeing_program_id is not null and (affected_program is null or g.dyeing_program_id=affected_program)
   union all select r.origin,r.lab_dip_id,g.source_dyeing_program_id,r.path||r.source,r.source=any(r.path)
   from reuse r join garments_erp.dyeing_program_lab_dip g on g.dyeing_program_id=r.source and g.lab_dip_id=r.lab_dip_id where not r.cycle
  ) select 1 from reuse where cycle)
 then raise exception 'Previous Program reuse cannot contain a cycle' using errcode='23514';end if;
 return null;
end $$;
CREATE OR REPLACE FUNCTION garments_erp.check_fabric_plan_dyeing_links() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  requirement_id bigint;
  program_item_id bigint;
  version_id_to_check bigint;
  group_id_to_check bigint;
begin
  case tg_table_name
    when 'fabric_plan_dyeing_link' then
      requirement_id := new.item_part_fabric_id;
      program_item_id := new.dyeing_program_item_id;
    when 'item_part_fabric' then requirement_id := new.id;
    when 'dyeing_program_item' then program_item_id := new.id;
    when 'lab_dip_version' then version_id_to_check := new.id;
    when 'dyeing_program_lab_dip' then group_id_to_check := new.id;
  end case;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'garments_erp.fabric_plan_dyeing_link', 0
  ));

  if exists (
    select 1 from garments_erp.fabric_plan_dyeing_link l
    join garments_erp.item_part_fabric f on f.id = l.item_part_fabric_id
    join garments_erp.dyeing_program_item p on p.id = l.dyeing_program_item_id
    join garments_erp.dyeing_program_lab_dip edition_group on edition_group.id=p.dyeing_program_lab_dip_id
    join garments_erp.lab_dip_version version on version.id = edition_group.lab_dip_version_id
    where (requirement_id is null or f.id = requirement_id)
      and (program_item_id is null or p.id = program_item_id)
      and (version_id_to_check is null or version.id = version_id_to_check)
      and (group_id_to_check is null or edition_group.id=group_id_to_check)
      and (f.fabric_type_id <> p.fabric_type_id or f.lab_dip_id is distinct from version.lab_dip_id)
  ) then
    raise exception 'Fabric plan and dyeing program must share the fabric type and lab dip' using errcode = '23514';
  end if;
  return new;
end $$;

-- Fail before installing guards over conflicting Final legacy documents.
do $$ begin
 if exists(select 1 from garments_erp.dyeing_program p where p.dyeing_program_status_id is distinct from 1 and (
   not exists(select 1 from garments_erp.dyeing_program_lab_dip g where g.dyeing_program_id=p.id) or
   exists(select 1 from garments_erp.dyeing_program_lab_dip g where g.dyeing_program_id=p.id and not exists(select 1 from garments_erp.dyeing_program_item i where i.dyeing_program_lab_dip_id=g.id))))
 then raise exception 'Remediation preflight: Final program has an empty edition group; reconcile explicitly';end if;
end $$;
create function garments_erp.fabric_linked_required_kg(p_item bigint) returns numeric
language sql stable set search_path='' as $$
 select round(coalesce(sum(r.required_kg),0),3) from garments_erp.fabric_plan_dyeing_link l
 join garments_erp.fabric_plan_requirements r on r.id=l.item_part_fabric_id where l.dyeing_program_item_id=p_item
$$;
revoke all on function garments_erp.fabric_linked_required_kg(bigint) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION garments_erp.fabric_contract() RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select '{"yarnTypes": {"yarn_type": ["name", "yarn_count"]}, "fabricTypes": {"fabric_type": ["name", "series"]}, "brands": {"brand_list": ["brand", "contacts_id", "contact_purpose_id"]}, "colours": {"color_map": ["name", "pantone_code"]}, "colourMappings": {"color_map_by_brand": ["color_map_id", "brand_list_id"]}, "labDips": {"lab_dip": ["date", "edition", "color_map_by_brand_id", "dyer_id"], "lab_dip_version": ["lab_dip_id", "version", "date", "shade_card_no", "shade_card_option", "comments", "lab_dip_status_id", "attached_swatch"]}, "suppliers": {"contacts": ["company_name"], "yarn_supplier": ["contacts_id", "contact_purpose_id"], "knitter": ["contacts_id", "contact_purpose_id"], "dyer": ["contacts_id", "contact_purpose_id"]}, "orders": {"yarn_purchase_order": ["yarn_supplier_id"], "yarn_purchase_order_item": ["purchase_order_number_id", "yarn_type_id", "quantity", "rate"]}, "yarn": {"yarn_bill": ["invoice_number", "invoice_date"], "yarn_bill_item": ["yarn_bill_id", "yarn_purchase_order_item_id", "billed_quantity", "billed_rate", "billed_bags"]}, "knitting": {"knitting_bill": ["invoice_number", "invoice_date", "knitter_id"], "knitting_bill_item": ["knitting_bill_id", "yarn_bill_item_id", "fabric_type_id", "greige_gsm", "consumption", "billed_quantity", "billed_rate", "billed_rolls"]}, "programs": {"dyeing_program": ["date", "dyer_id", "dyeing_program_status_id"], "dyeing_program_lab_dip": ["dyeing_program_id", "lab_dip_id", "lab_dip_version_id", "batch_no", "source_dyeing_program_id"], "dyeing_program_item": ["dyeing_program_id", "dyeing_program_lab_dip_id", "fabric_type_id", "quantity", "comments"]}, "dyeBills": {"dyed_fabric_bill": ["invoice_number", "invoice_date"], "dyed_fabric_item": ["dyed_fabric_bill_id", "dyeing_program_item_id", "knitting_bill_item_id", "gross_quantity", "billed_quantity", "final_quantity", "dyeing_rolls", "dyeing_rate"], "batch_no_lab_dip_version_map": ["dyed_fabric_item_id", "batch_no", "lab_dip_version_id"]}, "dyed": {}, "yarnLeft": {}, "greige": {}, "batches": {}}'::jsonb
$$;

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
  linked_total:=garments_erp.fabric_linked_required_kg(link_item);
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
  if actual='0'::jsonb and not (root_table='dyeing_program' and exists(select 1 from garments_erp.dyeing_program p where p.id=root_id::bigint and p.dyeing_program_status_id=1)) then raise exception 'A document must contain at least one line or version';end if;
 end if;
 -- Weight gain and shortage are allowed. Only source identity/type compatibility is checked.
 select coalesce(array_agg(distinct ref) filter(where ref is not null),array[]::text[]) into changed_dyed from (select coalesce(mapped->>(c->>'id'),c->>'id') ref from jsonb_array_elements(p_changes) c where c->>'table'='dyed_fabric_item' and c->'values'<>'null'::jsonb and exists(select 1 from unnest(array['billed_quantity','gross_quantity','final_quantity','knitting_bill_item_id','dyeing_program_item_id']) f where c->'before'->f is distinct from c->'values'->f)) q;
 select coalesce(array_agg(distinct ref) filter(where ref is not null),array[]::text[]) into changed_program from (select coalesce(mapped->>(c->>'id'),c->>'id') ref from jsonb_array_elements(p_changes) c where c->>'table'='dyeing_program_item' and c->'values'<>'null'::jsonb and exists(select 1 from unnest(array['fabric_type_id']) f where c->'before'->f is distinct from c->'values'->f)) q;
 if exists(select 1 from garments_erp.dyed_fabric_item d join garments_erp.dyeing_program_item p on p.id=d.dyeing_program_item_id join garments_erp.knitting_bill_item k on k.id=d.knitting_bill_item_id where (d.id::text=any(changed_dyed) or p.id::text=any(changed_program)) and p.fabric_type_id<>k.fabric_type_id) then raise exception 'The changed dyeing program fabric type does not match its knitted source.';end if;
 set constraints all immediate;
 insert into garments_access.app_activity_log(actor_user_id,app_resource_id,action,target_type,target_id,details)
 values(auth.uid(),(select id from garments_access.app_resource where key=p_resource),'Saved '||p_action||' document',root_table,root_id,jsonb_build_object('screen',p_resource,'changed_rows',jsonb_array_length(p_changes))||case when p_resource='programs' then jsonb_build_object('changes',p_changes,'resolved_ids',mapped) else '{}'::jsonb end);
 if p_resource='dyeBills' then
  if p_verifier is null then raise exception 'Dyed bill password verification required' using errcode='42501';end if;
  update garments_erp.dyed_fabric_bill set verified_by_employee_id=p_verifier where id=root_id::bigint;
 end if;
 return garments_erp.fabric_snapshot() || jsonb_build_object('_saved_id', root_id);
end $_$;
CREATE OR REPLACE FUNCTION garments_erp.fabric_planner_snapshot() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if auth.uid() is null or not garments_access.has_screen_permission('productionItems', 'view')
      or not garments_access.has_screen_permission('programs', 'view') then
    raise exception 'Fabric planner requires item and dyeing program access' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'variants', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', vi.id::text, 'item_id', i.id::text, 'style_code', i.style_code,
        'variant', v.variant_name,
        'part_id', part.id::text, 'part', name.part, 'parent_id', part.parent_item_part_id::text,
        'brand_id', i.brand_id::text
      ) order by i.style_code, part.id, vi.id), '[]')
      from garments_erp.variant_item vi
      join garments_erp.item_part part on part.id = vi.item_part_id
      join garments_erp.part_list name on name.id = part.part_list_id
      join garments_erp.item i on i.id = part.item_id
      join garments_erp.variant v on v.id = vi.variant_id
    ),
    'sub_parts',(select coalesce(jsonb_agg(jsonb_build_object('id',id::text,'part',part) order by part),'[]') from garments_erp.sub_part_list),
    'statuses',(select jsonb_agg(jsonb_build_object('id',id::text,'type',type) order by id) from garments_erp.item_part_fabric_status),
    'lab_dips',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id::text,'name',c.name||' · Edition '||l.edition,'colour',c.name,'color_map_by_brand_id',m.id::text,'dyer_id',l.dyer_id::text,'edition',l.edition,'brand',brand.brand,'brand_id',m.brand_list_id::text) order by c.name,l.id),'[]')
      from garments_erp.lab_dip l join garments_erp.color_map_by_brand m on m.id=l.color_map_by_brand_id join garments_erp.color_map c on c.id=m.color_map_id join garments_erp.brand_list brand on brand.id=m.brand_list_id),
    'actual_consumption',(select coalesce(jsonb_agg(jsonb_build_object('variant_item_id',x.variant_item_id::text,'fabric_type_id',x.fabric_type_id::text,'consumed_kg',x.kg)),'[]') from (
      select o.variant_item_id,p.fabric_type_id,sum(o.quantity) as kg from garments_erp.raw_material_check_out o
      join garments_erp.raw_material_check_in r on r.id=o.raw_material_check_in_id
      join garments_erp.dyed_fabric_item d on d.id=r.dyed_fabric_item_id
      join garments_erp.dyeing_program_item p on p.id=d.dyeing_program_item_id
      where not o.reconciliation and o.variant_item_id is not null group by o.variant_item_id,p.fabric_type_id
    ) x),
    'fabric_types', (
      select coalesce(jsonb_agg(jsonb_build_object('id', f.id::text, 'name', f.name)
        order by f.name, f.id), '[]')
      from garments_erp.fabric_type f
    ),
    'requirements', (
      select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
        'revision',(select garments_erp.fabric_json('item_part_fabric',to_jsonb(f)) from garments_erp.item_part_fabric f where f.id=r.id),'id', r.id::text, 'variant_item_id', r.variant_item_id::text,
        'fabric_type_id', r.fabric_type_id::text, 'item_part_id', r.item_part_id::text,
        'item_id', r.item_id::text, 'variant_id', r.variant_id::text,
        'sub_part_list_id',r.sub_part_list_id::text,'manual_status_id',r.manual_status_id::text,
        'item_part_fabric_status_id',r.item_part_fabric_status_id::text,'lab_dip_id', r.lab_dip_id::text, 'root_item_part_id', r.root_item_part_id::text,
        'production_id', r.production_id::text
      ) order by r.id), '[]')
      from garments_erp.fabric_plan_estimates r
    ),
    'program_items', (
      select coalesce(jsonb_agg(to_jsonb(q) || jsonb_build_object(
        'dyeing_program_item_id', p.id::text, 'dyeing_program_id', program.id::text,
        'fabric_type_id', p.fabric_type_id::text, 'lab_dip_id', version.lab_dip_id::text,
        'lab_dip_version', version.version, 'program_number', program.program_number,
        'program_status',coalesce(status.type,'Unclassified'),'quantity',p.quantity,
        'program_revision',garments_erp.fabric_json('dyeing_program',to_jsonb(program)),
        'linked_required_kg',garments_erp.fabric_linked_required_kg(p.id)
      ) order by program.id, p.id), '[]')
      from garments_erp.fabric_plan_dyeing_surplus q
      join garments_erp.dyeing_program_item p on p.id = q.dyeing_program_item_id
      join garments_erp.dyeing_program program on program.id = p.dyeing_program_id
      join garments_erp.dyeing_program_lab_dip edition_group on edition_group.id=p.dyeing_program_lab_dip_id
      join garments_erp.lab_dip_version version on version.id = edition_group.lab_dip_version_id
      left join garments_erp.dyeing_program_status status on status.id=program.dyeing_program_status_id
    ),
    'links', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'item_part_fabric_id', l.item_part_fabric_id::text,
        'dyeing_program_item_id', l.dyeing_program_item_id::text
      ) order by l.item_part_fabric_id, l.dyeing_program_item_id), '[]')
      from garments_erp.fabric_plan_dyeing_link l
    )
  );
end $$;

drop function public.erp_set_fabric_plan_dyeing_link(bigint,bigint,boolean,text);
drop function garments_erp.set_fabric_plan_dyeing_link(bigint,bigint,boolean,text);
create function garments_erp.set_fabric_plan_dyeing_link(p_requirement bigint,p_program_item bigint,p_linked boolean,p_screen text,p_expected jsonb,p_reviewed_required_kg numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pid bigint; actual jsonb; old_quantity numeric; revised numeric; changed integer;
begin
 if auth.uid() is null or p_screen is null or p_screen not in ('productionItems','programs')
  or not garments_access.has_screen_permission(p_screen,'edit')
  or not garments_access.has_screen_permission('productionItems','view')
  or not garments_access.has_screen_permission('programs','view') then raise exception 'Fabric planner link permission required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(741208531);
 select dyeing_program_id,quantity into pid,old_quantity from garments_erp.dyeing_program_item where id=p_program_item for update;
 select garments_erp.fabric_json('dyeing_program',to_jsonb(p)) into actual from garments_erp.dyeing_program p where p.id=pid for update;
 if p_expected is null or actual is null or actual is distinct from p_expected->'program'
  or (select garments_erp.fabric_json('item_part_fabric',to_jsonb(f)) from garments_erp.item_part_fabric f where f.id=p_requirement) is distinct from p_expected->'requirement'
 then raise exception 'Planner or program changed. Reload and review again.' using errcode='40001';end if;
 if p_linked is null then raise exception 'Select a link action';end if;
 if p_linked then insert into garments_erp.fabric_plan_dyeing_link values(p_requirement,p_program_item) on conflict do nothing;
 else delete from garments_erp.fabric_plan_dyeing_link where item_part_fabric_id=p_requirement and dyeing_program_item_id=p_program_item;end if;
 get diagnostics changed=row_count;
 revised:=garments_erp.fabric_linked_required_kg(p_program_item);
 if p_reviewed_required_kg is null or revised is distinct from p_reviewed_required_kg then raise exception 'Planner quantities changed. Reload and reconfirm the complete links.' using errcode='40001';end if;
 if changed>0 then
  if p_linked then update garments_erp.dyeing_program_item set quantity=revised where id=p_program_item;end if;
  insert into garments_access.app_activity_log(actor_user_id,app_resource_id,action,target_type,target_id,details)
   values(auth.uid(),(select id from garments_access.app_resource where key=p_screen),case when p_linked then 'Linked fabric requirement' else 'Unlinked fabric requirement' end,
   'dyeing_program_item',p_program_item::text,jsonb_build_object('screen',p_screen,'dyeing_program_id',pid::text,'item_part_fabric_id',p_requirement::text,
    'previous_quantity',old_quantity,'quantity',case when p_linked then revised else old_quantity end));
 end if;
 set constraints garments_erp.check_lab_dip_traceability,garments_erp.check_fabric_plan_dyeing_links immediate;
 set constraints garments_erp.check_lab_dip_traceability deferred;
 return garments_erp.fabric_planner_snapshot();
end $$;
revoke all on function garments_erp.set_fabric_plan_dyeing_link(bigint,bigint,boolean,text,jsonb,numeric) from public,anon;
grant execute on function garments_erp.set_fabric_plan_dyeing_link(bigint,bigint,boolean,text,jsonb,numeric) to authenticated;
create function public.erp_set_fabric_plan_dyeing_link(p_requirement bigint,p_program_item bigint,p_linked boolean,p_screen text,p_expected jsonb,p_reviewed_required_kg numeric) returns jsonb
language sql security invoker set search_path='' as $$
 select garments_erp.set_fabric_plan_dyeing_link(p_requirement,p_program_item,p_linked,p_screen,p_expected,p_reviewed_required_kg)
$$;
revoke all on function public.erp_set_fabric_plan_dyeing_link(bigint,bigint,boolean,text,jsonb,numeric) from public,anon;
grant execute on function public.erp_set_fabric_plan_dyeing_link(bigint,bigint,boolean,text,jsonb,numeric) to authenticated,service_role;
CREATE OR REPLACE FUNCTION garments_erp.generate_dyeing_program_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
    fy_start integer;
    fy text;
    next_num bigint;
BEGIN
    fy_start = CASE
        WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4
        THEN CAST(EXTRACT(YEAR FROM CURRENT_DATE) AS integer)
        ELSE CAST(EXTRACT(YEAR FROM CURRENT_DATE) AS integer) - 1
    END;

    fy = RIGHT(CAST(fy_start AS text), 2) || '-' || RIGHT(CAST(fy_start + 1 AS text), 2);

    INSERT INTO garments_erp.document_number_counter AS c
        (document_type, financial_year, last_number)
    VALUES ('SCD', fy, 1)
    ON CONFLICT (document_type, financial_year)
    DO UPDATE SET last_number = c.last_number + 1
    RETURNING c.last_number INTO next_num;

    NEW.program_number = 'SCD/' || LPAD(CAST(next_num AS text), greatest(length(next_num::text),3), '0') || '/' || fy;

    RETURN NEW;
END;
$function$
;
-- Measured with the same guarded dataset; generic OR-filter plans scanned unrelated programs.
alter function garments_erp.check_lab_dip_traceability() set plan_cache_mode='force_custom_plan';
alter function garments_erp.check_fabric_plan_dyeing_links() set plan_cache_mode='force_custom_plan';
set constraints all immediate;
commit;
notify pgrst, 'reload schema';
