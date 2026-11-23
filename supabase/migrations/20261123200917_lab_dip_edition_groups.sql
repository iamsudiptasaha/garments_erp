-- Edition groups own version and historical batch selection. No allocation/costing changes.
begin;
set local lock_timeout = '10s';
lock table garments_erp.dyeing_program, garments_erp.dyeing_program_item,
 garments_erp.lab_dip_version, garments_erp.batch_no_lab_dip_version_map in share row exclusive mode;
-- Fail closed: never select an arbitrary version or batch from a conflicting legacy group.
do $$ begin
 if exists(select 1 from garments_erp.dyeing_program_item i
  left join garments_erp.lab_dip_version v on v.id=i.lab_dip_version_id
  left join garments_erp.lab_dip l on l.id=v.lab_dip_id
  join garments_erp.dyeing_program p on p.id=i.dyeing_program_id
  left join garments_erp.batch_no_lab_dip_version_map b on b.id=i.batch_no
  left join garments_erp.lab_dip_version bv on bv.id=b.lab_dip_version_id
  where v.id is null or l.id is null or p.dyer_id is distinct from l.dyer_id
   or (i.batch_no is not null and (b.id is null or bv.lab_dip_id<>l.id)))
 then raise exception 'Edition-group preflight: orphan, dyer or historical batch mismatch';end if;
 if exists(select 1 from garments_erp.dyeing_program_item i
  join garments_erp.lab_dip_version v on v.id=i.lab_dip_version_id
  group by i.dyeing_program_id,v.lab_dip_id
  having count(distinct i.lab_dip_version_id)>1
   or count(distinct coalesce(i.batch_no::text,'NULL'))>1)
 then raise exception 'Edition-group preflight: conflicting versions or batches; reconcile explicitly';end if;
 if exists(select 1 from garments_erp.dyeing_program_item i
  join garments_erp.lab_dip_version v on v.id=i.lab_dip_version_id
  group by i.dyeing_program_id having count(distinct v.lab_dip_id)>6)
 then raise exception 'Edition-group preflight: more than six editions';end if;
end $$;
alter table garments_erp.lab_dip_version add constraint lab_dip_version_edition_identity unique(id,lab_dip_id);
create table garments_erp.dyeing_program_lab_dip (
 id bigint generated always as identity primary key,
 dyeing_program_id bigint not null references garments_erp.dyeing_program(id),
 lab_dip_id bigint not null references garments_erp.lab_dip(id),
 lab_dip_version_id bigint not null,
 batch_no bigint references garments_erp.batch_no_lab_dip_version_map(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(dyeing_program_id,lab_dip_id),unique(id,dyeing_program_id),
 foreign key(lab_dip_version_id,lab_dip_id) references garments_erp.lab_dip_version(id,lab_dip_id)
);
alter table garments_erp.dyeing_program_lab_dip enable row level security;
revoke all on garments_erp.dyeing_program_lab_dip from public,anon,authenticated;
create trigger zz_stamp_updated_at before insert or update on garments_erp.dyeing_program_lab_dip
 for each row execute function garments_erp.stamp_updated_at();
insert into garments_erp.dyeing_program_lab_dip(dyeing_program_id,lab_dip_id,lab_dip_version_id,batch_no)
 select i.dyeing_program_id,v.lab_dip_id,min(i.lab_dip_version_id),min(i.batch_no)
 from garments_erp.dyeing_program_item i join garments_erp.lab_dip_version v on v.id=i.lab_dip_version_id
 group by i.dyeing_program_id,v.lab_dip_id;
alter table garments_erp.dyeing_program_item add column dyeing_program_lab_dip_id bigint;
update garments_erp.dyeing_program_item i set dyeing_program_lab_dip_id=g.id
 from garments_erp.dyeing_program_lab_dip g,garments_erp.lab_dip_version v
 where v.id=i.lab_dip_version_id and g.dyeing_program_id=i.dyeing_program_id and g.lab_dip_id=v.lab_dip_id;
set constraints all immediate;
set constraints all deferred;
alter table garments_erp.dyeing_program_item alter column dyeing_program_lab_dip_id set not null;
alter table garments_erp.dyeing_program_item add constraint dyeing_program_item_group_owner
 foreign key(dyeing_program_lab_dip_id,dyeing_program_id)
 references garments_erp.dyeing_program_lab_dip(id,dyeing_program_id);
create index dyeing_program_item_group on garments_erp.dyeing_program_item(dyeing_program_lab_dip_id);
-- Use the same transaction lock as document saves. Serialize direct and RPC group writes.
create function garments_erp.guard_dyeing_program_group() returns trigger
 language plpgsql set search_path='' as $$ begin
 perform pg_catalog.pg_advisory_xact_lock(741208531);
 if tg_op<>'DELETE' then
  if tg_op='UPDATE' and new.dyeing_program_id<>old.dyeing_program_id then
   raise exception 'An edition group cannot move between programs' using errcode='23514';end if;

 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function garments_erp.guard_dyeing_program_group() from public;
create trigger guard_dyeing_program_group before insert or update or delete
 on garments_erp.dyeing_program_lab_dip for each row execute function garments_erp.guard_dyeing_program_group();


create or replace function garments_erp.check_lab_dip_traceability() returns trigger
language plpgsql set search_path='' as $$ begin
 if exists(select 1 from garments_erp.dyeing_program_lab_dip group by dyeing_program_id having count(*)>6) then raise exception 'A dyeing program permits at most six edition groups' using errcode='23514';end if;
 if exists(select 1 from garments_erp.dyed_fabric_item d left join garments_erp.batch_no_lab_dip_version_map b on b.dyed_fabric_item_id=d.id where b.id is null) then raise exception 'Every dyed-fabric item requires one batch mapping';end if;
 if exists(select 1 from garments_erp.batch_no_lab_dip_version_map b
  join garments_erp.dyed_fabric_item d on d.id=b.dyed_fabric_item_id
  join garments_erp.dyeing_program_item i on i.id=d.dyeing_program_item_id
  join garments_erp.dyeing_program_lab_dip g on g.id=i.dyeing_program_lab_dip_id
  where g.lab_dip_version_id<>b.lab_dip_version_id)
 then raise exception 'Batch and originating program must reference the same lab-dip version';end if;
 if exists(select 1 from garments_erp.dyeing_program_lab_dip g
  join garments_erp.dyeing_program p on p.id=g.dyeing_program_id
  join garments_erp.lab_dip l on l.id=g.lab_dip_id where p.dyer_id is distinct from l.dyer_id)
 then raise exception 'Lab-dip dyer must match the program dyer';end if;
 if exists(select 1 from garments_erp.dyeing_program_lab_dip g
  join garments_erp.batch_no_lab_dip_version_map b on b.id=g.batch_no
  join garments_erp.lab_dip_version v on v.id=b.lab_dip_version_id where v.lab_dip_id<>g.lab_dip_id)
 then raise exception 'Previous batch must use the same lab-dip edition';end if;
 if exists(select 1 from garments_erp.dyeing_program_lab_dip g
  join garments_erp.batch_no_lab_dip_version_map b on b.id=g.batch_no
  join garments_erp.dyed_fabric_item d on d.id=b.dyed_fabric_item_id
  join garments_erp.dyeing_program_item i on i.id=d.dyeing_program_item_id where i.dyeing_program_id=g.dyeing_program_id)
 then raise exception 'A program cannot use its own output as a previous batch';end if;
 if exists(select 1 from garments_erp.item_part_fabric f
  join garments_erp.variant_item vi on vi.id=f.variant_item_id
  join garments_erp.item_part ip on ip.id=vi.item_part_id
  join garments_erp.item it on it.id=ip.item_id
  join garments_erp.lab_dip l on l.id=f.lab_dip_id
  join garments_erp.color_map_by_brand cm on cm.id=l.color_map_by_brand_id
  where it.brand_id is distinct from cm.brand_list_id)
 then raise exception 'Selected fabric requirement lab dip must match the item brand';end if;
 return null;
end $$;
create constraint trigger check_lab_dip_traceability after insert or update or delete
 on garments_erp.dyeing_program_lab_dip deferrable initially deferred for each row
 execute function garments_erp.check_lab_dip_traceability();
create constraint trigger check_lab_dip_traceability after insert or update or delete
 on garments_erp.item_part_fabric deferrable initially deferred for each row
 execute function garments_erp.check_lab_dip_traceability();


CREATE OR REPLACE FUNCTION garments_erp.check_fabric_plan_dyeing_links() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  requirement_id bigint;
  program_item_id bigint;
  version_id_to_check bigint;
begin
  case tg_table_name
    when 'fabric_plan_dyeing_link' then
      requirement_id := new.item_part_fabric_id;
      program_item_id := new.dyeing_program_item_id;
    when 'item_part_fabric' then requirement_id := new.id;
    when 'dyeing_program_item' then program_item_id := new.id;
    when 'lab_dip_version' then version_id_to_check := new.id;
    when 'dyeing_program_lab_dip' then null;
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
      and (f.fabric_type_id <> p.fabric_type_id or f.lab_dip_id is distinct from version.lab_dip_id)
  ) then
    raise exception 'Fabric plan and dyeing program must share the fabric type and lab dip' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger check_fabric_plan_dyeing_links on garments_erp.dyeing_program_item;
create constraint trigger check_fabric_plan_dyeing_links after update of dyeing_program_lab_dip_id,fabric_type_id
 on garments_erp.dyeing_program_item deferrable initially immediate for each row execute function garments_erp.check_fabric_plan_dyeing_links();
create constraint trigger check_fabric_plan_dyeing_links after update
 on garments_erp.dyeing_program_lab_dip deferrable initially immediate for each row execute function garments_erp.check_fabric_plan_dyeing_links();


CREATE OR REPLACE FUNCTION garments_erp.fabric_contract() RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select '{"yarnTypes": {"yarn_type": ["name", "yarn_count"]}, "fabricTypes": {"fabric_type": ["name", "series"]}, "brands": {"brand_list": ["brand", "contacts_id", "contact_purpose_id"]}, "colours": {"color_map": ["name", "pantone_code"]}, "colourMappings": {"color_map_by_brand": ["color_map_id", "brand_list_id"]}, "labDips": {"lab_dip": ["date", "edition", "color_map_by_brand_id", "dyer_id"], "lab_dip_version": ["lab_dip_id", "version", "date", "shade_card_no", "shade_card_option", "comments", "lab_dip_status_id", "attached_swatch"]}, "suppliers": {"contacts": ["company_name"], "yarn_supplier": ["contacts_id", "contact_purpose_id"], "knitter": ["contacts_id", "contact_purpose_id"], "dyer": ["contacts_id", "contact_purpose_id"]}, "orders": {"yarn_purchase_order": ["yarn_supplier_id"], "yarn_purchase_order_item": ["purchase_order_number_id", "yarn_type_id", "quantity", "rate"]}, "yarn": {"yarn_bill": ["invoice_number", "invoice_date"], "yarn_bill_item": ["yarn_bill_id", "yarn_purchase_order_item_id", "billed_quantity", "billed_rate", "billed_bags"]}, "knitting": {"knitting_bill": ["invoice_number", "invoice_date", "knitter_id"], "knitting_bill_item": ["knitting_bill_id", "yarn_bill_item_id", "fabric_type_id", "greige_gsm", "consumption", "billed_quantity", "billed_rate", "billed_rolls"]}, "programs": {"dyeing_program": ["date", "dyer_id", "dyeing_program_status_id"], "dyeing_program_lab_dip": ["dyeing_program_id", "lab_dip_id", "lab_dip_version_id", "batch_no"], "dyeing_program_item": ["dyeing_program_id", "dyeing_program_lab_dip_id", "fabric_type_id", "quantity", "comments"]}, "dyeBills": {"dyed_fabric_bill": ["invoice_number", "invoice_date"], "dyed_fabric_item": ["dyed_fabric_bill_id", "dyeing_program_item_id", "knitting_bill_item_id", "gross_quantity", "billed_quantity", "final_quantity", "dyeing_rolls", "dyeing_rate"], "batch_no_lab_dip_version_map": ["dyed_fabric_item_id", "batch_no", "lab_dip_version_id"]}, "dyed": {}, "yarnLeft": {}, "greige": {}, "batches": {}}'::jsonb
$$;

CREATE OR REPLACE FUNCTION garments_erp.fabric_row_in_document(p_table text, p_row jsonb, p_root_table text, p_root_id text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if p_table=p_root_table then return p_row->>'id'=p_root_id;end if;
 if p_root_table='lab_dip' and p_table='lab_dip_version' then return p_row->>'lab_dip_id'=p_root_id;end if;
 if p_root_table='yarn_purchase_order' then return p_table='yarn_purchase_order_item' and p_row->>'purchase_order_number_id'=p_root_id;end if;
 if p_root_table='yarn_bill' then return p_table='yarn_bill_item' and p_row->>'yarn_bill_id'=p_root_id;end if;
 if p_root_table='knitting_bill' then return p_table='knitting_bill_item' and p_row->>'knitting_bill_id'=p_root_id;end if;
 if p_root_table='dyeing_program' then return p_table in ('dyeing_program_lab_dip','dyeing_program_item') and p_row->>'dyeing_program_id'=p_root_id;end if;
 if p_root_table='dyed_fabric_bill' then
  if p_table='dyed_fabric_item' then return p_row->>'dyed_fabric_bill_id'=p_root_id;end if;
  if p_table='batch_no_lab_dip_version_map' then return exists(select 1 from garments_erp.dyed_fabric_item d where d.id::text=p_row->>'dyed_fabric_item_id' and d.dyed_fabric_bill_id::text=p_root_id);end if;
 end if;
 if p_root_table=any(array['yarn_supplier','knitter','dyer']) and p_table='contacts' then return true;end if;
 return false;
end $$;

CREATE OR REPLACE FUNCTION garments_erp.fabric_snapshot() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare t text; rows jsonb; result jsonb:='{}'; fields text; keys text[]:=array(select jsonb_object_keys(garments_erp.fabric_contract()));
begin
 if auth.uid() is null or not exists(select 1 from unnest(keys) k where garments_access.has_screen_permission(k,'view')) then raise exception 'Fabric access is not enabled' using errcode='42501';end if;
 for t in select distinct d.table_name from garments_access.app_db_table d join garments_access.app_resource_table rt on rt.app_db_table_id=d.id join garments_access.app_resource r on r.id=rt.app_resource_id where d.schema_name='garments_erp' and r.key=any(keys) and rt.can_view and garments_access.has_screen_permission(r.key,'view') and d.table_name=any(array['contacts','contact_purpose','brand_list','yarn_supplier','knitter','dyer','yarn_type','fabric_type','color_map','color_map_by_brand','lab_dip','lab_dip_version','lab_dip_version_status','fabric_status_list','yarn_purchase_order','yarn_purchase_order_item','yarn_bill','yarn_bill_item','knitting_bill','knitting_bill_item','dyeing_program','dyeing_program_lab_dip','dyeing_program_item','dyed_fabric_bill','dyed_fabric_item','batch_no_lab_dip_version_map']) loop
  fields:=case when t='contacts' then 'jsonb_build_object(''id'',x.id::text,''company_name'',x.company_name,''updated_at'',x.updated_at)' else 'garments_erp.fabric_json('||quote_literal(t)||',to_jsonb(x))' end;
  execute format('select coalesce(jsonb_agg(%s order by x.id),''[]''::jsonb) from garments_erp.%I x',fields,t) into rows;
  result:=jsonb_set(result,array[t],rows);
 end loop;
 -- Attachment metadata only for records already visible in this snapshot. Private paths stay private.
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id::text,'filename',a.filename,'mime_type',a.mime_type,'file_size',a.file_size)),'[]'::jsonb) into rows from garments_erp.attachments a where a.id::text in (
 select r->>'bill_attachment' from jsonb_array_elements(coalesce(result->'yarn_bill','[]')||coalesce(result->'knitting_bill','[]')||coalesce(result->'dyed_fabric_bill','[]')) r
 union select r->>'shade_card_image_attachment' from jsonb_array_elements(coalesce(result->'lab_dip_version','[]')) r);
 -- Review records inherit the Lab Dips screen permission and visible version set.
 if garments_access.has_screen_permission('labDips','view') and result ? 'lab_dip_version' then
  result:=result||jsonb_build_object('lab_dip_version_item', (
   select coalesce(jsonb_agg(jsonb_build_object(
    'id',review.id::text,'lab_dip_version_id',review.lab_dip_version_id::text,
    'lab_dip_status_id',review.lab_dip_status_id::text,'comments',review.comments,
    'recorded_at',review.recorded_at,'date',review.date,'latest',review.latest
   ) order by review.id desc),'[]'::jsonb)
   from garments_erp.lab_dip_version_item review
   where review.lab_dip_version_id in (
    select (v->>'id')::bigint from jsonb_array_elements(result->'lab_dip_version') v
   )
  ));
 end if;

 if garments_access.has_screen_permission('programs','view') then
  result:=result||jsonb_build_object('dyeing_program_status',(select jsonb_agg(garments_erp.fabric_json('dyeing_program_status',to_jsonb(s)) order by s.id) from garments_erp.dyeing_program_status s));
  result:=result||jsonb_build_object('fabric_plan_dyeing_link',(
   select coalesce(jsonb_agg(jsonb_build_object('item_part_fabric_id',l.item_part_fabric_id::text,'dyeing_program_item_id',l.dyeing_program_item_id::text)),'[]'::jsonb)
   from garments_erp.fabric_plan_dyeing_link l where l.dyeing_program_item_id in
    (select (i->>'id')::bigint from jsonb_array_elements(coalesce(result->'dyeing_program_item','[]')) i)
  ));
 end if;
 return result||jsonb_build_object('attachments',rows,'_live',true);
end $$;

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
        'program_status',coalesce(status.type,'Unclassified')
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

CREATE VIEW garments_erp.view_item_part_fabric_labdip_status WITH (security_invoker='true') AS
 SELECT f.id,
    f.id AS item_part_fabric_id,
    pc.id AS production_checklist_id,
    f.lab_dip_id,
    l.edition,
    v.id AS lab_dip_version_id,
    v.version,
    s.status AS version_status,
        CASE
            WHEN (f.lab_dip_id IS NULL) THEN 'Lab dip not selected'::text
            WHEN (v.id IS NULL) THEN 'No versions yet'::text
            WHEN (s.id IS NULL) THEN 'Status not recorded'::text
            WHEN ((v.version > 1) AND (s.sort_order <= 3)) THEN ((('Redo '::text || (v.version)::text) || ' · '::text) || s.status)
            ELSE s.status
        END AS lab_dip_status
   FROM ((((((garments_erp.item_part_fabric f
 JOIN garments_erp.variant_item vi ON vi.id=f.variant_item_id
     JOIN garments_erp.item_part ip ON ((ip.id = vi.item_part_id)))
     LEFT JOIN garments_erp.production_checklist pc ON ((pc.item_id = ip.item_id)))
     LEFT JOIN garments_erp.lab_dip l ON ((l.id = f.lab_dip_id)))
     LEFT JOIN LATERAL ( SELECT vv.id,
            vv.version
           FROM garments_erp.lab_dip_version vv
          WHERE (vv.lab_dip_id = l.id)
          ORDER BY vv.version DESC
         LIMIT 1) v ON (true))
     LEFT JOIN garments_erp.lab_dip_version_item i ON (((i.lab_dip_version_id = v.id) AND i.latest)))
     LEFT JOIN garments_erp.lab_dip_version_status s ON ((s.id = i.lab_dip_status_id)));

revoke all on garments_erp.view_item_part_fabric_labdip_status from public,anon,authenticated;
grant select on garments_erp.view_item_part_fabric_labdip_status to service_role;

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
  update garments_erp.dyeing_program set updated_at=clock_timestamp() where id=(select dyeing_program_id from garments_erp.dyeing_program_item where id=p_program_item);
  return garments_erp.fabric_planner_snapshot();
end $$;


CREATE OR REPLACE FUNCTION garments_erp.production_setup_contract() RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select '{"productionItems": {"item": ["style_code", "brand_id", "story", "season", "product_type_list_id", "product_description", "base_price", "batch_number"], "item_part": ["item_id", "part_list_id", "parent_item_part_id"], "item_size_list": ["item_id", "size_list_id"], "item_cut_ratio": ["item_size_list_id", "pieces"], "variant_item": ["item_part_id", "variant_id"], "item_part_fabric": ["variant_item_id", "fabric_type_id", "sub_part_list_id", "sub_part_name", "lab_dip_id", "consumption_per_piece_kg", "item_part_fabric_status_id"], "production_checklist": ["item_id", "fpt_gpt_status_id", "photoshoot_sample_status_id", "shipment_sample_status_id", "techpack_aqcuired_status_id", "ordersheet_acquired_status_id"]}, "productionWorkers": {"job_worker": ["contacts_id", "contact_purpose_id"]}, "productionDesigns": {"variant": ["variant_name", "share_weight"]}, "productionStages": {"stage": ["name", "abbr", "sort_order", "stage_type_id", "track_pieces", "pp_stage"]}, "productionStageTypes": {"stage_type": ["name"]}, "productionPartTypes": {"part_list": ["part"]}, "productionSizes": {"size_list": ["size", "sort_order"]}, "productionProductTypes": {"product_type_list": ["product_type", "gender_id"]}, "productionStatuses": {"item_status_list": ["status"]}, "productionFlags": {"flags_list": ["name"]}, "productionGenders": {"gender": ["name"]}}'::jsonb
$$;

CREATE OR REPLACE FUNCTION garments_erp.fabric_json(p_table text, p_row jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare c record; result jsonb:=p_row;
begin
 for c in select a.attname from pg_catalog.pg_attribute a where a.attrelid=pg_catalog.to_regclass('garments_erp.'||p_table) and a.atttypid='pg_catalog.int8'::pg_catalog.regtype and a.attnum>0 and not a.attisdropped loop
  if result->c.attname is not null and result->c.attname<>'null'::jsonb then result:=jsonb_set(result,array[c.attname],to_jsonb(result->>c.attname));end if;
 end loop;
 if p_table='lab_dip_version' then
  result:=result||coalesce((select jsonb_build_object('date',i.date,'comments',i.comments,'lab_dip_status_id',i.lab_dip_status_id::text)
   from garments_erp.lab_dip_version_item i where i.lab_dip_version_id=(p_row->>'id')::bigint and i.latest),
   jsonb_build_object('date',null,'comments',null,'lab_dip_status_id',null));
 end if;
 if p_table='dyeing_program' then
  -- A link-only change must invalidate the reviewed complete set even when updated_at is a no-op.
  result:=result||jsonb_build_object('_planner_links_revision',(
   select md5(coalesce(jsonb_agg(jsonb_build_array(l.item_part_fabric_id::text,l.dyeing_program_item_id::text)
    order by l.item_part_fabric_id,l.dyeing_program_item_id),'[]'::jsonb)::text)
   from garments_erp.fabric_plan_dyeing_link l join garments_erp.dyeing_program_item i on i.id=l.dyeing_program_item_id
   where i.dyeing_program_id=(p_row->>'id')::bigint
  ));
 end if;
 return result;
end $$;

-- Catalogue permissions stay private and inherit the existing resource capabilities.
insert into garments_access.app_db_table(schema_name,table_name) values
 ('garments_erp','dyeing_program_lab_dip'),('garments_erp','view_item_part_fabric_labdip_status') on conflict do nothing;
insert into garments_access.app_resource_table(app_resource_id,app_db_table_id,relation_type,can_view,can_create,can_edit,can_delete)
 select rt.app_resource_id,n.id,rt.relation_type,rt.can_view,rt.can_create,rt.can_edit,rt.can_delete
 from garments_access.app_resource_table rt join garments_access.app_db_table d on d.id=rt.app_db_table_id
 join garments_access.app_db_table n on n.schema_name='garments_erp' and n.table_name='dyeing_program_lab_dip'
 where d.schema_name='garments_erp' and d.table_name='dyeing_program_item' on conflict do nothing;
update garments_access.app_resource_table rt set app_db_table_id=n.id from garments_access.app_db_table old,garments_access.app_db_table n
 where rt.app_db_table_id=old.id and old.table_name='view_variant_item_lab_dip_status' and old.schema_name='garments_erp'
 and n.table_name='view_item_part_fabric_labdip_status' and n.schema_name='garments_erp';
delete from garments_access.app_db_table where schema_name='garments_erp' and table_name='view_variant_item_lab_dip_status';
-- Validate the entire backfilled graph through the new guards before retiring old fields.
-- The timestamp trigger preserves stamps for this no-op validation update.
update garments_erp.dyeing_program_lab_dip set batch_no=batch_no;
set constraints all immediate;
comment on column garments_erp.variant_item.lab_dip_id is 'Historical compatibility only. Fabric edition selection belongs to item_part_fabric.lab_dip_id.';
-- These columns have no remaining consumers in the new contract. Never DROP CASCADE.
alter table garments_erp.dyeing_program_item drop column lab_dip_version_id,drop column batch_no;
drop view garments_erp.view_variant_item_lab_dip_status;
-- The phrase is not an eligibility/approval mutation. Rename only existing persisted labels.
update garments_erp.lab_dip_version_status set status=replace(status,'Approved for Previous Program','Approved from Previous Program')
 where status like '%Approved for Previous Program%';
set constraints all immediate;
commit;
