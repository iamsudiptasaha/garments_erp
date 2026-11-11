begin;

lock table garments_erp.challan, garments_erp.challan_job_item,
  garments_erp.challan_job_item_pieces, garments_erp.variant_item_per_job in access exclusive mode;

-- A line with multiple variants or rates cannot be split automatically because
-- its bill item references the original line and is unique per line.
do $$
declare
  misc_has_rows boolean;
begin
  if to_regclass('garments_erp.challan_job_item_misc') is not null then
    lock table garments_erp.challan_job_item_misc in access exclusive mode;
    execute 'select exists (select 1 from garments_erp.challan_job_item_misc)' into misc_has_rows;
    if misc_has_rows then
      raise exception 'Reconcile obsolete miscellaneous details before migrating';
    end if;
  end if;
  if exists (select 1 from garments_erp.variant_item_per_job where per_piece_billed_price is not null) then
    raise exception 'Reconcile legacy job-variant rates to worker bills before migrating';
  end if;
end $$;

alter table garments_erp.challan_job_item
  add column variant_item_per_job_id bigint references garments_erp.variant_item_per_job(id),
  add column rate numeric,
  add column description text;

with source as (
  select challan_job_item_id, min(variant_item_id) as variant_item_id, min(rate) as rate
  from garments_erp.challan_job_item_pieces
  group by challan_job_item_id
  having count(distinct variant_item_id) = 1
    and (count(rate) = 0 or (count(rate) = count(*) and min(rate) = max(rate)))
)
update garments_erp.challan_job_item line
set variant_item_per_job_id = assignment.id, rate = source.rate
from source, garments_erp.variant_item_per_job assignment
where source.challan_job_item_id = line.id
  and assignment.job_id = line.job_id and assignment.variant_item_id = source.variant_item_id;

do $$
begin
  if exists (select 1 from garments_erp.challan_job_item where variant_item_per_job_id is null) then
    raise exception 'Challan lines require an unambiguous job-variant and a consistent legacy size rate';
  end if;
end $$;

-- Drain queued checks while their original columns still exist.
set constraints all immediate;
set constraints all deferred;

alter table garments_erp.challan_job_item
  alter column variant_item_per_job_id set not null,
  drop column job_id;
create index challan_job_item_assignment_idx on garments_erp.challan_job_item(variant_item_per_job_id);
create index challan_job_item_challan_idx on garments_erp.challan_job_item(challan_id);

alter table garments_erp.challan_job_item_pieces
  drop column variant_item_id,
  drop column rate,
  add constraint challan_piece_line_size_key unique (challan_job_item_id, item_size_list_id);
drop table if exists garments_erp.challan_job_item_misc;


create or replace function garments_erp.check_production_variant_links() returns trigger
language plpgsql set search_path = '' as $$
begin
 if exists(select 1 from garments_erp.variant_item_per_job link join garments_erp.job j on j.id=link.job_id
   join garments_erp.production pr on pr.id=j.production_id join garments_erp.variant_item vi on vi.id=link.variant_item_id
   where pr.item_part_id<>vi.item_part_id) then raise exception 'Job variants must belong to the production item part';end if;
 if exists(select 1 from garments_erp.stage_pieces p join garments_erp.variant_item_per_job link on link.id=p.variant_item_per_job_id
   join garments_erp.variant_item vi on vi.id=link.variant_item_id join garments_erp.item_part ip on ip.id=vi.item_part_id
   join garments_erp.item_size_list sz on sz.id=p.item_size_list_id where ip.item_id<>sz.item_id)
   then raise exception 'Stage size must belong to the job item';end if;
 if exists(select 1 from garments_erp.stage_pieces p join garments_erp.variant_item_per_job link on link.id=p.variant_item_per_job_id
   join garments_erp.job j on j.id=link.job_id join garments_erp.stage s on s.id=j.stage_id where s.pp_stage or not s.track_pieces)
   then raise exception 'This stage does not track production pieces';end if;
 if exists (
   select 1 from garments_erp.challan_job_item_pieces piece
   join garments_erp.challan_job_item line on line.id = piece.challan_job_item_id
   join garments_erp.variant_item_per_job assignment on assignment.id = line.variant_item_per_job_id
   join garments_erp.variant_item variant on variant.id = assignment.variant_item_id
   join garments_erp.item_part part on part.id = variant.item_part_id
   join garments_erp.item_size_list size on size.id = piece.item_size_list_id
   where part.item_id <> size.item_id
 ) then raise exception 'Challan size must belong to the line item'; end if;
 return null;
end $$;

-- The existing unique constraint on job_worker_bill_items.challan_job_item_id
-- keeps each challan line billable once, even across concurrent bills.

create function garments_erp.check_challan_stock_in() returns trigger
language plpgsql set search_path = '' as $$
declare
  line_ids bigint[];
  line_id bigint;
  assignment_id bigint;
begin
  if tg_table_name = 'challan_job_item' then
    line_ids := array[new.id];
  elsif tg_op = 'UPDATE' then
    line_ids := array[old.challan_job_item_id, new.challan_job_item_id];
  elsif tg_op = 'DELETE' then
    line_ids := array[old.challan_job_item_id];
  else
    line_ids := array[new.challan_job_item_id];
  end if;

  foreach line_id in array line_ids loop
    select variant_item_per_job_id into assignment_id
    from garments_erp.challan_job_item where id = line_id;
    if not found then continue; end if;

    if not exists (
      select 1 from garments_erp.stage_pieces
      where variant_item_per_job_id = assignment_id
    ) or exists (
      select 1
      from (
        select item_size_list_id, pieces_stock_in
        from garments_erp.stage_pieces where variant_item_per_job_id = assignment_id
      ) stock
      full join (
        select item_size_list_id, issued_pieces
        from garments_erp.challan_job_item_pieces where challan_job_item_id = line_id
      ) issue using (item_size_list_id)
      where stock.item_size_list_id is null
        or stock.pieces_stock_in < 0
        or stock.pieces_stock_in <> trunc(stock.pieces_stock_in)
        or issue.issued_pieces is distinct from stock.pieces_stock_in
    ) then
      raise exception 'Challan line % must match full job stock-in by size', line_id
        using errcode = '23514';
    end if;
  end loop;
  return null;
end;
$$;

alter table garments_erp.challan_job_item_pieces
  add constraint challan_whole_issued_pieces check (
    issued_pieces is not null and issued_pieces >= 0
    and issued_pieces < 'Infinity'::numeric and issued_pieces = trunc(issued_pieces)
  );

create constraint trigger check_challan_stock_in
after insert or update of variant_item_per_job_id on garments_erp.challan_job_item
deferrable initially deferred for each row execute function garments_erp.check_challan_stock_in();

create constraint trigger check_challan_stock_in
after insert or update or delete on garments_erp.challan_job_item_pieces
deferrable initially deferred for each row execute function garments_erp.check_challan_stock_in();

create or replace view garments_erp.item_costing_job_reference with (security_invoker = true) as
select part.item_id,
  link.id as variant_item_per_job_id,
  pieces.reference_quantity,
  billing.rate as reference_rate,
  pieces.reference_quantity * billing.rate as reference_amount
from garments_erp.variant_item_per_job link
join garments_erp.variant_item variant on variant.id = link.variant_item_id
join garments_erp.item_part part on part.id = variant.item_part_id
cross join lateral (
  select sum(stage_pieces.pieces_stock_out) as reference_quantity
  from garments_erp.stage_pieces
  where stage_pieces.variant_item_per_job_id = link.id
) pieces
cross join lateral (
  select sum(bill_item.billed_rate) as rate
  from garments_erp.variant_item_per_job assignment
  join garments_erp.challan_job_item line on line.variant_item_per_job_id = assignment.id
  join garments_erp.job_worker_bill_items bill_item on bill_item.challan_job_item_id = line.id
  where assignment.job_id = link.job_id
) billing;

create or replace function public.erp_item_costing_start(p_item_id bigint)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  costing_id bigint;
  accepted numeric;
begin
  if not garments_access.has_screen_permission('finishedProducts', 'create') then
    raise exception 'Finished Products create access required' using errcode = '42501';
  end if;
  perform id from garments_erp.item where id = p_item_id for update;
  if not exists (select 1 from garments_erp.costing_ready_items() where id = p_item_id) then
    raise exception 'Every item part must have a current job with stage type Complete';
  end if;

  select c.id into costing_id
  from garments_erp.item_costing c join garments_erp.item_costing_status s on s.id = c.item_costing_status_id
  where c.item_id = p_item_id and s.name = 'draft' order by c.version desc limit 1;
  if found then return costing_id::text; end if;

  select sum(size_units) into accepted
  from (
    select sz.id, min(coalesce(parts.pieces, 0)) as size_units
    from garments_erp.item_size_list sz
    join garments_erp.item_part ip on ip.item_id = sz.item_id
    left join lateral (
      select sum(sp.pieces_stock_in) as pieces
      from garments_erp.production p
      join garments_erp.job j on j.production_id = p.id and j.latest
      join garments_erp.stage st on st.id = j.stage_id
      join garments_erp.stage_type typ on typ.id = st.stage_type_id and lower(typ.name) = 'complete'
      join garments_erp.variant_item_per_job vj on vj.job_id = j.id
      join garments_erp.variant_item v on v.id = vj.variant_item_id and v.item_part_id = ip.id
      join garments_erp.stage_pieces sp on sp.variant_item_per_job_id = vj.id
      where p.item_part_id = ip.id and sp.item_size_list_id = sz.id
    ) parts on true
    where sz.item_id = p_item_id
    group by sz.id
  ) sizes;
  if coalesce(accepted, 0) <= 0 then raise exception 'No accepted production pieces available'; end if;

  insert into garments_erp.item_costing
    (item_id, item_produced_id, version, item_costing_status_id, completed_units)
  select p_item_id,
    (select id from garments_erp.item_produced where item_id = p_item_id order by id limit 1),
    (select coalesce(max(version), 0) + 1 from garments_erp.item_costing where item_id = p_item_id),
    id, accepted
  from garments_erp.item_costing_status where name = 'draft'
  returning id into costing_id;

  insert into garments_erp.item_costing_item
    (item_costing_id, item_costing_section_id, variant_item_per_job_id,
     item_costing_origin_type_id, item_costing_calculation_method_id, description,
     reference_quantity, reference_rate, reference_amount)
  select costing_id, section.id, link.id, origin.id, method.id, stage.name || ' · ' || job.job_code,
    sum(sp.pieces_stock_out), sum(sp.pieces_stock_in) * reference.reference_rate /
      nullif(sum(sp.pieces_stock_out), 0), sum(sp.pieces_stock_in) * reference.reference_rate
  from garments_erp.variant_item_per_job link
  join garments_erp.variant_item v on v.id = link.variant_item_id
  join garments_erp.item_part p on p.id = v.item_part_id
  join garments_erp.job job on job.id = link.job_id
  join garments_erp.stage stage on stage.id = job.stage_id
  join garments_erp.stage_pieces sp on sp.variant_item_per_job_id = link.id
  join garments_erp.item_costing_job_reference reference on reference.variant_item_per_job_id = link.id
  cross join garments_erp.item_costing_section section
  cross join garments_erp.item_costing_origin_type origin
  cross join garments_erp.item_costing_calculation_method method
  where p.item_id = p_item_id and stage.track_pieces and reference.reference_rate is not null
    and section.section = 'Production' and origin.name = 'job' and method.name = 'erp'
  group by section.id, link.id, origin.id, method.id, stage.name, job.job_code, reference.reference_rate;

  insert into garments_erp.item_costing_item
    (item_costing_id, item_costing_section_id, raw_material_check_out_id,
     item_costing_origin_type_id, item_costing_calculation_method_id, description,
     reference_quantity, reference_rate, reference_amount)
  select costing_id, section.id, issue.id, origin.id, method.id,
    coalesce(material.name, dyed.description, 'Material issue ' || issue.id),
    accepted, issue.quantity * receipt.billed_price / accepted, issue.quantity * receipt.billed_price
  from garments_erp.raw_material_check_out issue
  join garments_erp.raw_material_check_in receipt on receipt.id = issue.raw_material_check_in_id
  join garments_erp.variant_item v on v.id = issue.variant_item_id
  join garments_erp.item_part part on part.id = v.item_part_id
  left join garments_erp.raw_material_item material on material.id = receipt.raw_material_item_id
  left join garments_erp.dyed_fabric_item dyed on dyed.id = receipt.dyed_fabric_item_id
  left join garments_erp.category_list category
    on category.id = coalesce(receipt.material_category_id, material.category_list_id)
  join garments_erp.item_costing_section section on section.section = case
    when lower(category.type) in ('fabric', 'fabrics') then 'Fabrics'
    when lower(category.type) in ('trim', 'trims', 'accessory', 'accessories', 'trims and accessories')
      then 'Trims and Accessories'
    when dyed.id is not null then 'Fabrics'
  end
  cross join garments_erp.item_costing_origin_type origin
  cross join garments_erp.item_costing_calculation_method method
  where part.item_id = p_item_id and not coalesce(issue.reconciliation, false)
    and origin.name = 'material' and method.name = 'erp';

  if exists (
    select 1 from garments_erp.raw_material_check_out issue
    join garments_erp.variant_item v on v.id = issue.variant_item_id
    join garments_erp.item_part part on part.id = v.item_part_id
    where part.item_id = p_item_id and not coalesce(issue.reconciliation, false)
      and not exists (
        select 1 from garments_erp.item_costing_item line
        where line.item_costing_id = costing_id and line.raw_material_check_out_id = issue.id
      )
  ) then
    raise exception 'Classify linked material receipts as Fabrics or Trims and Accessories before costing';
  end if;

  insert into garments_erp.item_costing_item
    (item_costing_id, item_costing_section_id, item_costing_peripherals_type_id,
     item_costing_origin_type_id, item_costing_calculation_method_id, description, approved_rate)
  select costing_id, section.id, peripheral.id, origin.id, method.id, initcap(peripheral.type), 0
  from garments_erp.item_costing_peripherals_type peripheral
  cross join garments_erp.item_costing_section section
  cross join garments_erp.item_costing_origin_type origin
  cross join garments_erp.item_costing_calculation_method method
  where section.section = 'Peripherals' and origin.name = 'manual' and method.name = 'formula';

  insert into garments_erp.item_costing_item
    (item_costing_id, item_costing_section_id, item_costing_origin_type_id,
     item_costing_calculation_method_id, description, approved_quantity)
  select costing_id, section.id, origin.id, method.id, expense.description, accepted
  from (values ('Logistics estimate'), ('Photography'), ('Miscellaneous')) expense(description)
  cross join garments_erp.item_costing_section section
  cross join garments_erp.item_costing_origin_type origin
  cross join garments_erp.item_costing_calculation_method method
  where section.section = 'After production' and origin.name = 'manual' and method.name = 'manual';

  return costing_id::text;
end;
$$;

alter table garments_erp.variant_item_per_job drop column per_piece_billed_price;

commit;
