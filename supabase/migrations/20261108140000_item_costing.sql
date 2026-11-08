begin;
set local lock_timeout = '10s';

create table garments_erp.item_costing_status (
  id smallint generated always as identity primary key,
  name text not null unique
);
insert into garments_erp.item_costing_status (name) values ('draft'), ('finalized');

create table garments_erp.item_costing_origin_type (
  id smallint generated always as identity primary key,
  name text not null unique
);
insert into garments_erp.item_costing_origin_type (name) values ('job'), ('material'), ('manual');

create table garments_erp.item_costing_calculation_method (
  id smallint generated always as identity primary key,
  name text not null unique
);
insert into garments_erp.item_costing_calculation_method (name) values ('erp'), ('override'), ('manual'), ('formula');

create table garments_erp.item_costing (
  id bigint generated always as identity primary key,
  item_id bigint not null references garments_erp.item (id),
  version integer not null check (version > 0),
  item_costing_status_id smallint not null references garments_erp.item_costing_status (id),
  completed_units numeric check (completed_units >= 0 and completed_units < 'Infinity'::numeric),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, version)
);

create table garments_erp.item_costing_item (
  id bigint generated always as identity primary key,
  item_costing_id bigint not null references garments_erp.item_costing (id),
  variant_item_per_job_id bigint references garments_erp.variant_item_per_job (id) on delete cascade,
  raw_material_check_out_id bigint references garments_erp.raw_material_check_out (id) on delete cascade,
  item_costing_origin_type_id smallint not null references garments_erp.item_costing_origin_type (id),
  item_costing_calculation_method_id smallint not null references garments_erp.item_costing_calculation_method (id),
  description text not null check (btrim(description) <> ''),
  reference_quantity numeric,
  reference_rate numeric,
  reference_amount numeric,
  approved_quantity numeric,
  approved_rate numeric,
  approved_amount numeric,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_costing_id, variant_item_per_job_id),
  unique (item_costing_id, raw_material_check_out_id),
  check (num_nonnulls(variant_item_per_job_id, raw_material_check_out_id) <= 1),
  check (
    greatest(reference_quantity, reference_rate, reference_amount,
      approved_quantity, approved_rate, approved_amount) < 'Infinity'::numeric
    and least(reference_quantity, reference_rate, approved_quantity, approved_rate) >= 0
    and least(reference_amount, approved_amount) > '-Infinity'::numeric
  )
);

create index item_costing_job_source_idx on garments_erp.item_costing_item (variant_item_per_job_id);
create index item_costing_material_source_idx on garments_erp.item_costing_item (raw_material_check_out_id);

create function garments_access.guard_item_costing()
returns trigger language plpgsql set search_path = '' as $$
declare
  status_name text;
begin
  if tg_op <> 'INSERT' and exists (
    select 1 from garments_erp.item_costing_status
    where id = old.item_costing_status_id and name = 'finalized'
  ) then
    raise exception 'Finalized costing is immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.id, new.item_id, new.version)
      is distinct from (old.id, old.item_id, old.version) then
    raise exception 'Costing identity is immutable';
  end if;

  select name into strict status_name from garments_erp.item_costing_status
    where id = new.item_costing_status_id;
  if status_name = 'finalized' then
    if tg_op = 'INSERT' or auth.uid() is null or coalesce(new.completed_units, 0) <= 0
      or not exists (
        select 1 from garments_erp.item_costing_item where item_costing_id = new.id
      ) or exists (
        select 1 from garments_erp.item_costing_item
        where item_costing_id = new.id and approved_amount is null
      ) then
      raise exception 'Finalization requires an authenticated approver, positive completed units and approved line amounts';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := clock_timestamp();
  else
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end;
$$;

create function garments_access.guard_item_costing_item()
returns trigger language plpgsql set search_path = '' as $$
declare
  header_id bigint;
  costing_item_id bigint;
  status_name text;
  origin_name text;
  source_item_id bigint;
begin
  if tg_op = 'UPDATE' and new.item_costing_id <> old.item_costing_id then
    raise exception 'A costing line cannot move between versions';
  end if;
  header_id := case when tg_op = 'DELETE' then old.item_costing_id else new.item_costing_id end;
  select c.item_id, s.name into strict costing_item_id, status_name
  from garments_erp.item_costing c
  join garments_erp.item_costing_status s on s.id = c.item_costing_status_id
  where c.id = header_id for update of c;

  if status_name <> 'draft' then
    raise exception 'Only draft costing lines can change';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  select name into strict origin_name from garments_erp.item_costing_origin_type
    where id = new.item_costing_origin_type_id;
  if origin_name = 'job' then
    select part.item_id into source_item_id
    from garments_erp.variant_item_per_job link
    join garments_erp.variant_item variant on variant.id = link.variant_item_id
    join garments_erp.item_part part on part.id = variant.item_part_id
    where link.id = new.variant_item_per_job_id;
  elsif origin_name = 'material' then
    select part.item_id into source_item_id
    from garments_erp.raw_material_check_out checkout
    join garments_erp.variant_item variant on variant.id = checkout.variant_item_id
    join garments_erp.item_part part on part.id = variant.item_part_id
    where checkout.id = new.raw_material_check_out_id;
  elsif num_nonnulls(new.variant_item_per_job_id, new.raw_material_check_out_id) = 0 then
    source_item_id := costing_item_id;
  end if;

  if source_item_id is distinct from costing_item_id then
    raise exception 'Costing origin and source must match the costing item';
  end if;
  return new;
end;
$$;

create trigger guard_item_costing before insert or update or delete on garments_erp.item_costing
for each row execute function garments_access.guard_item_costing();
create trigger guard_item_costing_item before insert or update or delete on garments_erp.item_costing_item
for each row execute function garments_access.guard_item_costing_item();

create trigger zz_stamp_updated_at before insert or update on garments_erp.item_costing
for each row execute function garments_access.stamp_updated_at();
create trigger zz_stamp_updated_at before insert or update on garments_erp.item_costing_item
for each row execute function garments_access.stamp_updated_at();

-- Aggregate before joining any other transaction data. A missing billed rate
-- leaves the amount unknown, even when stage quantities are available.
create view garments_erp.item_costing_job_reference with (security_invoker = true) as
select part.item_id,
  link.id as variant_item_per_job_id,
  pieces.reference_quantity,
  link.per_piece_billed_price as reference_rate,
  pieces.reference_quantity * link.per_piece_billed_price as reference_amount
from garments_erp.variant_item_per_job link
join garments_erp.variant_item variant on variant.id = link.variant_item_id
join garments_erp.item_part part on part.id = variant.item_part_id
cross join lateral (
  select sum(stage_pieces.pieces_stock_out) as reference_quantity
  from garments_erp.stage_pieces
  where stage_pieces.variant_item_per_job_id = link.id
) pieces;

-- Latest is derived so a new version never updates a finalized header.
create view garments_erp.item_costing_summary with (security_invoker = true) as
select c.*,
  c.version = max(c.version) over (partition by c.item_id) as latest,
  totals.total_cost,
  totals.total_cost / nullif(c.completed_units, 0) as final_unit_cost
from garments_erp.item_costing c
cross join lateral (
  select coalesce(sum(line.approved_amount), 0) as total_cost
  from garments_erp.item_costing_item line where line.item_costing_id = c.id
) totals;

alter table garments_erp.item_costing enable row level security;
alter table garments_erp.item_costing_item enable row level security;
alter table garments_erp.item_costing_status enable row level security;
alter table garments_erp.item_costing_origin_type enable row level security;
alter table garments_erp.item_costing_calculation_method enable row level security;

revoke all on garments_erp.item_costing, garments_erp.item_costing_item,
  garments_erp.item_costing_summary, garments_erp.item_costing_job_reference,
  garments_erp.item_costing_status,
  garments_erp.item_costing_origin_type, garments_erp.item_costing_calculation_method
  from public, anon, authenticated, service_role;
revoke all on function garments_access.guard_item_costing(),
  garments_access.guard_item_costing_item() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
