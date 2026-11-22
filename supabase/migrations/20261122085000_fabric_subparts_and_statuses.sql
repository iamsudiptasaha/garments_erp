begin;
set local lock_timeout = '10s';

create table garments_erp.sub_part_list (
 id bigint generated always as identity primary key,
 part text not null unique check (btrim(part) <> '')
);
create table garments_erp.item_part_fabric_status (
 id bigint primary key, type text not null unique
);
insert into garments_erp.item_part_fabric_status values
 (1,'Not ordered'),(2,'Ordered'),(3,'Received'),(4,'On hold'),(5,'Reused in-house fabric');
create table garments_erp.dyeing_program_status (
 id bigint primary key, type text not null unique
);
insert into garments_erp.dyeing_program_status values (1,'Draft'),(2,'Final');
alter table garments_erp.sub_part_list enable row level security;
alter table garments_erp.item_part_fabric_status enable row level security;
alter table garments_erp.dyeing_program_status enable row level security;
revoke all on garments_erp.sub_part_list, garments_erp.item_part_fabric_status,
 garments_erp.dyeing_program_status from public, anon, authenticated;

alter table garments_erp.item_part_fabric
 drop constraint item_part_fabric_variant_item_id_fabric_type_id_key,
 add column sub_part_list_id bigint references garments_erp.sub_part_list(id),
 add column sub_part_name text,
 add column lab_dip_id bigint references garments_erp.lab_dip(id),
 add column item_part_fabric_status_id bigint references garments_erp.item_part_fabric_status(id),
 add constraint fabric_requirement_manual_status check (item_part_fabric_status_id in (4,5));
-- NULL means automatic. Automatic states are derived centrally in fabric_plan_estimates.
-- Leave historical sub-part names/types unspecified; preserve every requirement identity.
update garments_erp.item_part_fabric f set lab_dip_id=v.lab_dip_id
 from garments_erp.variant_item v where v.id=f.variant_item_id;
create index item_part_fabric_variant on garments_erp.item_part_fabric(variant_item_id);
create index item_part_fabric_lab on garments_erp.item_part_fabric(lab_dip_id);
alter table garments_erp.dyeing_program
 add column dyeing_program_status_id bigint references garments_erp.dyeing_program_status(id);
alter table garments_erp.dyeing_program alter column dyeing_program_status_id set default 1;
-- A recorded bill is positive historical evidence of an issued program.
update garments_erp.dyeing_program p set dyeing_program_status_id=2 where exists (
 select 1 from garments_erp.dyeing_program_item i
 join garments_erp.dyed_fabric_item d on d.dyeing_program_item_id=i.id where i.dyeing_program_id=p.id
);
-- Existing programs without evidence remain NULL and do not count as ordered.
do $$ declare ambiguous bigint; begin
 select count(*) into ambiguous from garments_erp.dyeing_program where dyeing_program_status_id is null;
 if ambiguous>0 then raise warning '% historical dyeing programs need explicit Draft/Final classification',ambiguous;end if;
end $$;

create or replace function garments_erp.check_fabric_plan_dyeing_links()
returns trigger language plpgsql set search_path = '' as $$
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
  end case;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'garments_erp.fabric_plan_dyeing_link', 0
  ));

  if exists (
    select 1 from garments_erp.fabric_plan_dyeing_link l
    join garments_erp.item_part_fabric f on f.id = l.item_part_fabric_id
    join garments_erp.dyeing_program_item p on p.id = l.dyeing_program_item_id
    join garments_erp.lab_dip_version version on version.id = p.lab_dip_version_id
    where (requirement_id is null or f.id = requirement_id)
      and (program_item_id is null or p.id = program_item_id)
      and (version_id_to_check is null or version.id = version_id_to_check)
      and (f.fabric_type_id <> p.fabric_type_id or f.lab_dip_id is distinct from version.lab_dip_id)
  ) then
    raise exception 'Fabric plan and dyeing program must share the fabric type and lab dip' using errcode = '23514';
  end if;
  return new;
end $$;


drop trigger check_fabric_plan_dyeing_links on garments_erp.variant_item;
drop trigger check_fabric_plan_dyeing_links on garments_erp.item_part_fabric;
create constraint trigger check_fabric_plan_dyeing_links
 after update of fabric_type_id, lab_dip_id on garments_erp.item_part_fabric
 deferrable initially immediate for each row execute function garments_erp.check_fabric_plan_dyeing_links();

create or replace view garments_erp.fabric_plan_requirements with (security_invoker = true) as
with part_variants as (
  select vi.id, vi.variant_id, vi.item_part_id, ip.item_id,
    count(*) over (partition by vi.item_part_id) as variant_count,
    row_number() over (partition by vi.item_part_id order by vi.id) as variant_number
  from garments_erp.variant_item vi
  join garments_erp.item_part ip on ip.id = vi.item_part_id
), planned_pieces as (
  select v.id, v.variant_id, v.item_part_id,
    coalesce(sum(trunc(cr.pieces / v.variant_count)
      + case when v.variant_number <= mod(cr.pieces, v.variant_count) then 1 else 0 end), 0) as pieces
  from part_variants v
  left join garments_erp.item_size_list sz on sz.item_id = v.item_id
  left join garments_erp.item_cut_ratio cr on cr.item_size_list_id = sz.id
  group by v.id, v.variant_id, v.item_part_id
)
select f.id, f.variant_item_id, f.fabric_type_id, f.consumption_per_piece_kg,
  v.item_part_id, item_part.item_id, v.variant_id, f.lab_dip_id,
  h.root_item_part_id, h.production_id, plan.pieces as planned_pieces,
  plan.pieces * f.consumption_per_piece_kg as required_kg,
  null::numeric as consumed_kg, f.sub_part_list_id, f.sub_part_name,
  f.item_part_fabric_status_id as manual_status_id
from garments_erp.item_part_fabric f
join garments_erp.variant_item v on v.id = f.variant_item_id
join garments_erp.item_part item_part on item_part.id = v.item_part_id
join garments_erp.item_part_production_root h on h.item_part_id = v.item_part_id
join planned_pieces plan on plan.id = v.id
;

create or replace view garments_erp.fabric_plan_dyeing_quantities with (security_invoker=true) as
select p.id as dyeing_program_item_id,
 case when program.dyeing_program_status_id=2 then greatest(coalesce(p.quantity,0),0) else 0 end as ordered_kg,
 coalesce(sum(d.final_quantity) filter(where b.verified_by_employee_id is not null
  and d.final_quantity>0 and d.final_quantity<'Infinity'::numeric),0) as received_kg
from garments_erp.dyeing_program_item p
join garments_erp.dyeing_program program on program.id=p.dyeing_program_id
left join garments_erp.dyed_fabric_item d on d.dyeing_program_item_id=p.id
left join garments_erp.dyed_fabric_bill b on b.id=d.dyed_fabric_bill_id
group by p.id,p.quantity,program.dyeing_program_status_id;

create or replace view garments_erp.fabric_plan_estimates with (security_invoker = true) as
with ordered as (
  select item_part_fabric_id, sum(estimated_kg) as kg
  from garments_erp.fabric_plan_coverage(false) group by item_part_fabric_id
), received as (
  select item_part_fabric_id, sum(estimated_kg) as kg
  from garments_erp.fabric_plan_coverage(true) group by item_part_fabric_id
)
select r.id, r.variant_item_id, r.fabric_type_id, r.consumption_per_piece_kg, r.item_part_id, r.item_id, r.variant_id, r.lab_dip_id, r.root_item_part_id, r.production_id, r.planned_pieces, r.required_kg, r.consumed_kg, coalesce(o.kg, 0) as estimated_ordered_kg,
  coalesce(a.kg, 0) as estimated_received_kg,
  r.required_kg - coalesce(o.kg, 0) as order_shortage_kg,
  r.required_kg - coalesce(a.kg, 0) as receipt_shortage_kg,
 r.sub_part_list_id,r.sub_part_name,r.manual_status_id,
 coalesce(r.manual_status_id,case
  when exists(select 1 from garments_erp.fabric_plan_dyeing_link l
    join garments_erp.dyed_fabric_item d on d.dyeing_program_item_id=l.dyeing_program_item_id
    join garments_erp.dyed_fabric_bill b on b.id=d.dyed_fabric_bill_id
    where l.item_part_fabric_id=r.id and b.verified_by_employee_id is not null
      and d.final_quantity>0 and d.final_quantity<'Infinity'::numeric) then 3
  when exists(select 1 from garments_erp.fabric_plan_dyeing_link l
    join garments_erp.dyeing_program_item p on p.id=l.dyeing_program_item_id
    join garments_erp.dyeing_program program on program.id=p.dyeing_program_id
    where l.item_part_fabric_id=r.id and program.dyeing_program_status_id=2) then 2
  else 1 end) as item_part_fabric_status_id
from garments_erp.fabric_plan_requirements r
left join ordered o on o.item_part_fabric_id = r.id
left join received a on a.item_part_fabric_id = r.id;


create or replace function garments_erp.production_setup_contract()
returns jsonb language sql immutable set search_path = '' as $$
  select '{"productionItems": {"item": ["style_code", "brand_id", "story", "season", "product_type_list_id", "product_description", "base_price", "batch_number"], "item_part": ["item_id", "part_list_id", "parent_item_part_id"], "item_size_list": ["item_id", "size_list_id"], "item_cut_ratio": ["item_size_list_id", "pieces"], "variant_item": ["item_part_id", "variant_id", "lab_dip_id"], "item_part_fabric": ["variant_item_id", "fabric_type_id", "sub_part_list_id", "sub_part_name", "lab_dip_id", "consumption_per_piece_kg", "item_part_fabric_status_id"], "production_checklist": ["item_id", "fpt_gpt_status_id", "photoshoot_sample_status_id", "shipment_sample_status_id", "techpack_aqcuired_status_id", "ordersheet_acquired_status_id"]}, "productionWorkers": {"job_worker": ["contacts_id", "contact_purpose_id"]}, "productionDesigns": {"variant": ["variant_name", "share_weight"]}, "productionStages": {"stage": ["name", "abbr", "sort_order", "stage_type_id", "track_pieces", "pp_stage"]}, "productionStageTypes": {"stage_type": ["name"]}, "productionPartTypes": {"part_list": ["part"]}, "productionSizes": {"size_list": ["size", "sort_order"]}, "productionProductTypes": {"product_type_list": ["product_type", "gender_id"]}, "productionStatuses": {"item_status_list": ["status"]}, "productionFlags": {"flags_list": ["name"]}, "productionGenders": {"gender": ["name"]}}'::jsonb
$$;
create or replace function garments_erp.fabric_contract()
returns jsonb language sql immutable set search_path = '' as $$
  select '{"yarnTypes": {"yarn_type": ["name", "yarn_count"]}, "fabricTypes": {"fabric_type": ["name", "series"]}, "brands": {"brand_list": ["brand", "contacts_id", "contact_purpose_id"]}, "colours": {"color_map": ["name", "pantone_code"]}, "colourMappings": {"color_map_by_brand": ["color_map_id", "brand_list_id"]}, "labDips": {"lab_dip": ["date", "edition", "color_map_by_brand_id", "dyer_id"], "lab_dip_version": ["lab_dip_id", "version", "date", "shade_card_no", "shade_card_option", "comments", "lab_dip_status_id", "attached_swatch"]}, "suppliers": {"contacts": ["company_name"], "yarn_supplier": ["contacts_id", "contact_purpose_id"], "knitter": ["contacts_id", "contact_purpose_id"], "dyer": ["contacts_id", "contact_purpose_id"]}, "orders": {"yarn_purchase_order": ["yarn_supplier_id"], "yarn_purchase_order_item": ["purchase_order_number_id", "yarn_type_id", "quantity", "rate"]}, "yarn": {"yarn_bill": ["invoice_number", "invoice_date"], "yarn_bill_item": ["yarn_bill_id", "yarn_purchase_order_item_id", "billed_quantity", "billed_rate", "billed_bags"]}, "knitting": {"knitting_bill": ["invoice_number", "invoice_date", "knitter_id"], "knitting_bill_item": ["knitting_bill_id", "yarn_bill_item_id", "fabric_type_id", "greige_gsm", "consumption", "billed_quantity", "billed_rate", "billed_rolls"]}, "programs": {"dyeing_program": ["date", "dyer_id", "dyeing_program_status_id"], "dyeing_program_item": ["dyeing_program_id", "fabric_type_id", "quantity", "lab_dip_version_id", "batch_no", "comments"]}, "dyeBills": {"dyed_fabric_bill": ["invoice_number", "invoice_date"], "dyed_fabric_item": ["dyed_fabric_bill_id", "dyeing_program_item_id", "knitting_bill_item_id", "gross_quantity", "billed_quantity", "final_quantity", "dyeing_rolls", "dyeing_rate"], "batch_no_lab_dip_version_map": ["dyed_fabric_item_id", "batch_no", "lab_dip_version_id"]}, "dyed": {}, "yarnLeft": {}, "greige": {}, "batches": {}}'::jsonb
$$;
create or replace function garments_erp.production_row_owned(t text,r jsonb,root_table text,root_id text)
returns boolean language plpgsql stable set search_path='' as $$
begin
 if t=root_table then return r->>'id'=root_id;end if;
 if root_table<>'item' then return false;end if;
 if t in ('item_part','item_size_list','production_checklist') then return r->>'item_id'=root_id;end if;
 if t='item_cut_ratio' then return exists(select 1 from garments_erp.item_size_list s where s.id::text=r->>'item_size_list_id' and s.item_id::text=root_id);end if;
 if t='variant_item' then return exists(select 1 from garments_erp.item_part p where p.id::text=r->>'item_part_id' and p.item_id::text=root_id);end if;
 if t='item_part_fabric' then return exists(select 1 from garments_erp.variant_item v
  join garments_erp.item_part p on p.id=v.item_part_id where v.id::text=r->>'variant_item_id' and p.item_id::text=root_id);end if;
 return false;
end $$;

create or replace function garments_erp.fabric_planner_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not garments_access.has_screen_permission('productionItems', 'view')
      or not garments_access.has_screen_permission('programs', 'view') then
    raise exception 'Fabric planner requires item and dyeing program access' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'variants', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', vi.id::text, 'item_id', i.id::text, 'style_code', i.style_code,
        'variant', v.variant_name, 'colour', colour.name,
        'part_id', part.id::text, 'part', name.part, 'parent_id', part.parent_item_part_id::text,
        'lab_dip_id', vi.lab_dip_id::text
      ) order by i.style_code, part.id, vi.id), '[]')
      from garments_erp.variant_item vi
      join garments_erp.item_part part on part.id = vi.item_part_id
      join garments_erp.part_list name on name.id = part.part_list_id
      join garments_erp.item i on i.id = part.item_id
      join garments_erp.variant v on v.id = vi.variant_id
      left join garments_erp.lab_dip lab on lab.id = vi.lab_dip_id
      left join garments_erp.color_map_by_brand mapping on mapping.id = lab.color_map_by_brand_id
      left join garments_erp.color_map colour on colour.id = mapping.color_map_id
    ),
    'sub_parts',(select coalesce(jsonb_agg(jsonb_build_object('id',id::text,'part',part) order by part),'[]') from garments_erp.sub_part_list),
    'statuses',(select jsonb_agg(jsonb_build_object('id',id::text,'type',type) order by id) from garments_erp.item_part_fabric_status),
    'lab_dips',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id::text,'name',c.name||' · Edition '||l.edition||' · '||l.id,'colour',c.name) order by c.name,l.id),'[]')
      from garments_erp.lab_dip l join garments_erp.color_map_by_brand m on m.id=l.color_map_by_brand_id join garments_erp.color_map c on c.id=m.color_map_id),
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
      join garments_erp.lab_dip_version version on version.id = p.lab_dip_version_id
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


CREATE OR REPLACE FUNCTION garments_erp.production_workspace()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb:='{}';t text;rows jsonb;keys text[]:=array(select jsonb_object_keys(garments_erp.production_setup_contract())); jobs boolean:=garments_access.has_screen_permission('productionJobs','view');
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
  execute format('select coalesce(jsonb_agg(garments_erp.fabric_json(%L,to_jsonb(x)) order by x.id),''[]''::jsonb) from garments_erp.%I x',t,t) into rows;
  result:=result||jsonb_build_object(t,rows);
 end loop;
 -- Contacts only supply linked labels, never contact children or financial details.
 if jobs or garments_access.has_screen_permission('productionWorkers','view') then
 result:=result||jsonb_build_object('contacts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id::text,'company_name',c.company_name)),'[]') from garments_erp.contacts c where garments_access.has_screen_permission('productionWorkers','view') or exists(select 1 from garments_erp.job_worker w where w.contacts_id=c.id)));
 end if;
 if jobs then
 result:=result||jsonb_build_object('employee',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'name',c.company_name,'employee_code',e.employee_code,'is_active',true) order by e.id),'[]') from garments_erp.employee_with_status e join garments_erp.contacts c on c.id=e.contacts_id where e.is_active),
 'production_records',(garments_erp.production_snapshot()->'records'));
 end if;
 if jobs or garments_access.has_screen_permission('productionItems','view') then
 result:=result||jsonb_build_object('production_job_counts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select p.item_part_id::text,item_count.jobs from garments_erp.production p cross join lateral (select count(*)::integer jobs from garments_erp.job j where j.production_id=p.id) item_count) x));
 end if;
 if jobs or garments_access.has_screen_permission('productionWorkers','view') then
 result:=result||jsonb_build_object('production_worker_counts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select job_worker_id::text,count(*)::integer jobs from garments_erp.job where job_worker_id is not null group by job_worker_id) x));
 end if;
 result:=result||jsonb_build_object('attachments',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id::text,'filename',a.filename,'mime_type',a.mime_type)),'[]') from garments_erp.attachments a where a.id::text in(select x->>'image_attachment' from jsonb_array_elements(coalesce(result->'item','[]')) x)),'_live',true);

 if garments_access.has_screen_permission('productionItems','view') then
  result:=result||jsonb_build_object(
   'item_part_fabric',(select coalesce(jsonb_agg(garments_erp.fabric_json('item_part_fabric',to_jsonb(f)) order by f.id),'[]') from garments_erp.item_part_fabric f),
   'fabric_type',(select coalesce(jsonb_agg(garments_erp.fabric_json('fabric_type',to_jsonb(f)) order by f.id),'[]') from garments_erp.fabric_type f),
   'sub_part_list',(select coalesce(jsonb_agg(garments_erp.fabric_json('sub_part_list',to_jsonb(f)) order by f.id),'[]') from garments_erp.sub_part_list f),
   'item_part_fabric_status',(select jsonb_agg(garments_erp.fabric_json('item_part_fabric_status',to_jsonb(f)) order by f.id) from garments_erp.item_part_fabric_status f),
   'fabric_requirement_statuses',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id::text,'status_id',f.item_part_fabric_status_id::text)),'[]') from garments_erp.fabric_plan_estimates f));
 end if;
 return result;
end $function$;
CREATE OR REPLACE FUNCTION garments_erp.fabric_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t text; rows jsonb; result jsonb:='{}'; fields text; keys text[]:=array(select jsonb_object_keys(garments_erp.fabric_contract()));
begin
 if auth.uid() is null or not exists(select 1 from unnest(keys) k where garments_access.has_screen_permission(k,'view')) then raise exception 'Fabric access is not enabled' using errcode='42501';end if;
 for t in select distinct d.table_name from garments_access.app_db_table d join garments_access.app_resource_table rt on rt.app_db_table_id=d.id join garments_access.app_resource r on r.id=rt.app_resource_id where d.schema_name='garments_erp' and r.key=any(keys) and rt.can_view and garments_access.has_screen_permission(r.key,'view') and d.table_name=any(array['contacts','contact_purpose','brand_list','yarn_supplier','knitter','dyer','yarn_type','fabric_type','color_map','color_map_by_brand','lab_dip','lab_dip_version','lab_dip_version_status','fabric_status_list','yarn_purchase_order','yarn_purchase_order_item','yarn_bill','yarn_bill_item','knitting_bill','knitting_bill_item','dyeing_program','dyeing_program_item','dyed_fabric_bill','dyed_fabric_item','batch_no_lab_dip_version_map']) loop
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
 end if;
 return result||jsonb_build_object('attachments',rows,'_live',true);
end $function$;
drop function public.erp_save_fabric_requirement(bigint,bigint,numeric,numeric);
drop function garments_erp.save_fabric_requirement(bigint,bigint,numeric,numeric);
create function garments_erp.save_fabric_requirement(
 p_requirement bigint,p_variant bigint,p_expected jsonb,p_values jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
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
 return garments_erp.fabric_planner_snapshot();
end $$;
create function public.erp_save_fabric_requirement(p_requirement bigint,p_variant bigint,p_expected jsonb,p_values jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select garments_erp.save_fabric_requirement($1,$2,$3,$4) $$;
revoke execute on function garments_erp.save_fabric_requirement(bigint,bigint,jsonb,jsonb),public.erp_save_fabric_requirement(bigint,bigint,jsonb,jsonb) from public,anon;
grant execute on function garments_erp.save_fabric_requirement(bigint,bigint,jsonb,jsonb),public.erp_save_fabric_requirement(bigint,bigint,jsonb,jsonb) to authenticated;
commit;
