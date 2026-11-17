begin;

alter table garments_erp.item_part
  add column parent_item_part_id bigint,
  add constraint item_part_item_identity unique (item_id, id),
  add constraint item_part_same_item_parent
    foreign key (item_id, parent_item_part_id) references garments_erp.item_part(item_id, id),
  add constraint item_part_not_own_parent check (parent_item_part_id <> id);
create index item_part_parent on garments_erp.item_part(item_id, parent_item_part_id)
  where parent_item_part_id is not null;

create function garments_erp.check_item_part_production_root()
returns trigger language plpgsql set search_path = '' as $$
declare
  part_id bigint;
  item_id_to_check bigint;
begin
  if tg_table_name = 'item_part' then
    part_id := new.id;
  else
    part_id := new.item_part_id;
  end if;
  select item_id into item_id_to_check from garments_erp.item_part where id = part_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'garments_erp.item_part:' || item_id_to_check, 0
  ));

  if exists (
    with recursive ancestors(id, parent_item_part_id) as (
      select p.id, p.parent_item_part_id from garments_erp.item_part p where p.id = part_id
      union
      select p.id, p.parent_item_part_id from garments_erp.item_part p
      join ancestors a on p.id = a.parent_item_part_id
    )
    select 1 from ancestors where parent_item_part_id = part_id
  ) then
    raise exception 'Item part parent relationships cannot contain cycles' using errcode = '23514';
  end if;
  if exists (
    select 1 from garments_erp.item_part p
    where p.id = part_id and p.parent_item_part_id is not null
      and exists (select 1 from garments_erp.production r where r.item_part_id = p.id)
  ) then
    raise exception 'Dependent item parts cannot have independent production or jobs' using errcode = '23514';
  end if;
  return new;
end $$;

create constraint trigger check_item_part_production_root
  after insert or update of item_id, parent_item_part_id on garments_erp.item_part
  deferrable initially immediate for each row
  execute function garments_erp.check_item_part_production_root();
create constraint trigger check_item_part_production_root
  after insert or update of item_part_id on garments_erp.production
  deferrable initially immediate for each row
  execute function garments_erp.check_item_part_production_root();

create table garments_erp.item_part_fabric (
  id bigint generated always as identity primary key,
  variant_item_id bigint not null references garments_erp.variant_item(id),
  fabric_type_id bigint not null references garments_erp.fabric_type(id),
  consumption_per_piece_kg numeric not null
    check (consumption_per_piece_kg > 0 and consumption_per_piece_kg < 'Infinity'::numeric),
  unique (variant_item_id, fabric_type_id)
);
create index item_part_fabric_type on garments_erp.item_part_fabric(fabric_type_id);
alter table garments_erp.item_part_fabric enable row level security;

create table garments_erp.fabric_plan_dyeing_link (
  item_part_fabric_id bigint not null references garments_erp.item_part_fabric(id),
  dyeing_program_item_id bigint not null references garments_erp.dyeing_program_item(id),
  primary key (item_part_fabric_id, dyeing_program_item_id)
);
create index fabric_plan_dyeing_program
  on garments_erp.fabric_plan_dyeing_link(dyeing_program_item_id, item_part_fabric_id);
alter table garments_erp.fabric_plan_dyeing_link enable row level security;

create function garments_erp.check_fabric_plan_dyeing_links()
returns trigger language plpgsql set search_path = '' as $$
declare
  requirement_id bigint;
  program_item_id bigint;
  variant_id_to_check bigint;
  version_id_to_check bigint;
begin
  case tg_table_name
    when 'fabric_plan_dyeing_link' then
      requirement_id := new.item_part_fabric_id;
      program_item_id := new.dyeing_program_item_id;
    when 'item_part_fabric' then requirement_id := new.id;
    when 'dyeing_program_item' then program_item_id := new.id;
    when 'variant_item' then variant_id_to_check := new.id;
    when 'lab_dip_version' then version_id_to_check := new.id;
  end case;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'garments_erp.fabric_plan_dyeing_link', 0
  ));

  if exists (
    select 1 from garments_erp.fabric_plan_dyeing_link l
    join garments_erp.item_part_fabric f on f.id = l.item_part_fabric_id
    join garments_erp.variant_item v on v.id = f.variant_item_id
    join garments_erp.dyeing_program_item p on p.id = l.dyeing_program_item_id
    join garments_erp.lab_dip_version version on version.id = p.lab_dip_version_id
    where (requirement_id is null or f.id = requirement_id)
      and (program_item_id is null or p.id = program_item_id)
      and (variant_id_to_check is null or v.id = variant_id_to_check)
      and (version_id_to_check is null or version.id = version_id_to_check)
      and (f.fabric_type_id <> p.fabric_type_id or v.lab_dip_id is distinct from version.lab_dip_id)
  ) then
    raise exception 'Fabric plan and dyeing program must share the fabric type and lab dip' using errcode = '23514';
  end if;
  return new;
end $$;

create constraint trigger check_fabric_plan_dyeing_links
  after insert or update on garments_erp.fabric_plan_dyeing_link
  deferrable initially immediate for each row execute function garments_erp.check_fabric_plan_dyeing_links();
create constraint trigger check_fabric_plan_dyeing_links
  after update of variant_item_id, fabric_type_id on garments_erp.item_part_fabric
  deferrable initially immediate for each row execute function garments_erp.check_fabric_plan_dyeing_links();
create constraint trigger check_fabric_plan_dyeing_links
  after update of lab_dip_version_id, fabric_type_id on garments_erp.dyeing_program_item
  deferrable initially immediate for each row execute function garments_erp.check_fabric_plan_dyeing_links();
create constraint trigger check_fabric_plan_dyeing_links
  after update of lab_dip_id on garments_erp.variant_item
  deferrable initially immediate for each row execute function garments_erp.check_fabric_plan_dyeing_links();
create constraint trigger check_fabric_plan_dyeing_links
  after update of lab_dip_id on garments_erp.lab_dip_version
  deferrable initially immediate for each row execute function garments_erp.check_fabric_plan_dyeing_links();

create view garments_erp.item_part_production_root with (security_invoker = true) as
with recursive hierarchy as (
  select id as item_part_id, id as root_item_part_id
  from garments_erp.item_part where parent_item_part_id is null
  union all
  select child.id, h.root_item_part_id
  from garments_erp.item_part child
  join hierarchy h on h.item_part_id = child.parent_item_part_id
)
select hierarchy.item_part_id, hierarchy.root_item_part_id, p.id as production_id
from hierarchy
left join garments_erp.production p on p.item_part_id = hierarchy.root_item_part_id;

revoke all on garments_erp.item_part_fabric, garments_erp.fabric_plan_dyeing_link,
  garments_erp.item_part_production_root from public, anon, authenticated;

commit;
