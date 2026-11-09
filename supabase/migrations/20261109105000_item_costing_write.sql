begin;

create function public.erp_item_costing_start(p_item_id bigint)
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
    sum(sp.pieces_stock_out), sum(sp.pieces_stock_in) * link.per_piece_billed_price /
      nullif(sum(sp.pieces_stock_out), 0), sum(sp.pieces_stock_in) * link.per_piece_billed_price
  from garments_erp.variant_item_per_job link
  join garments_erp.variant_item v on v.id = link.variant_item_id
  join garments_erp.item_part p on p.id = v.item_part_id
  join garments_erp.job job on job.id = link.job_id
  join garments_erp.stage stage on stage.id = job.stage_id
  join garments_erp.stage_pieces sp on sp.variant_item_per_job_id = link.id
  cross join garments_erp.item_costing_section section
  cross join garments_erp.item_costing_origin_type origin
  cross join garments_erp.item_costing_calculation_method method
  where p.item_id = p_item_id and stage.track_pieces and link.per_piece_billed_price is not null
    and section.section = 'Production' and origin.name = 'job' and method.name = 'erp'
  group by section.id, link.id, origin.id, method.id, stage.name, job.job_code;

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

create function public.erp_item_costing_save(
  p_id bigint, p_updated_at timestamptz, p_lines jsonb, p_finalize boolean
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  costing garments_erp.item_costing%rowtype;
  entry record;
  updated_count integer;
  amount numeric;
  next_amount numeric;
  peripheral record;
begin
  if not garments_access.has_screen_permission('finishedProducts', 'create') then
    raise exception 'Finished Products create access required' using errcode = '42501';
  end if;
  select * into strict costing from garments_erp.item_costing where id = p_id for update;
  if costing.updated_at is distinct from p_updated_at or not exists (
    select 1 from garments_erp.item_costing_status where id = costing.item_costing_status_id and name = 'draft'
  ) then raise exception 'Costing changed. Reload before saving.'; end if;

  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Expected costing lines'; end if;
  if (select count(distinct x.id) from jsonb_to_recordset(p_lines) x(id bigint)) <>
     (select count(*) from garments_erp.item_costing_item where item_costing_id = p_id)
     or jsonb_array_length(p_lines) <> (select count(*) from garments_erp.item_costing_item where item_costing_id = p_id)
  then raise exception 'Expected each costing line exactly once'; end if;

  for entry in select * from jsonb_to_recordset(p_lines) x(id bigint, approved_quantity numeric, approved_rate numeric)
  loop
    if entry.approved_quantity <> trunc(entry.approved_quantity) then raise exception 'Enter whole approved pieces'; end if;
    update garments_erp.item_costing_item line
      set approved_quantity = entry.approved_quantity, approved_rate = entry.approved_rate,
          approved_amount = entry.approved_quantity * entry.approved_rate
      where line.id = entry.id and line.item_costing_id = p_id;
    get diagnostics updated_count = row_count;
    if updated_count <> 1 then raise exception 'Costing line is outside this version'; end if;
  end loop;

  select coalesce(sum(approved_amount), 0) into amount
    from garments_erp.item_costing_item where item_costing_id = p_id and item_costing_peripherals_type_id is null;
  for peripheral in
    select line.id, line.approved_rate, t.type
    from garments_erp.item_costing_item line
    join garments_erp.item_costing_peripherals_type t on t.id = line.item_costing_peripherals_type_id
    where line.item_costing_id = p_id
    order by array_position(array['overhead','rejection','discount','profit'], t.type)
  loop
    next_amount := case when peripheral.type = 'discount' then amount * (1 - peripheral.approved_rate / 100)
      else amount / (1 - peripheral.approved_rate / 100) end;
    update garments_erp.item_costing_item
    set approved_amount = next_amount - amount where id = peripheral.id;
    amount := next_amount;
  end loop;

  if p_finalize then
    update garments_erp.item_costing_item line set
      reference_amount = issue.quantity * receipt.billed_price,
      reference_rate = issue.quantity * receipt.billed_price / nullif(costing.completed_units, 0)
    from garments_erp.raw_material_check_out issue
    join garments_erp.raw_material_check_in receipt on receipt.id = issue.raw_material_check_in_id
    where line.item_costing_id = p_id and line.raw_material_check_out_id = issue.id;

    update garments_erp.item_costing
      set item_costing_status_id = (select id from garments_erp.item_costing_status where name = 'finalized')
      where id = p_id;
  else
    update garments_erp.item_costing set updated_at = clock_timestamp() where id = p_id;
  end if;
  return p_id::text;
end;
$$;

revoke all on function public.erp_item_costing_start(bigint),
  public.erp_item_costing_save(bigint, timestamptz, jsonb, boolean) from public, anon, authenticated, service_role;
grant execute on function public.erp_item_costing_start(bigint),
  public.erp_item_costing_save(bigint, timestamptz, jsonb, boolean) to authenticated;

create or replace view garments_erp.item_costing_summary with (security_invoker = true) as
select c.id, c.item_id, c.version, c.item_costing_status_id, c.completed_units,
  c.approved_by, c.approved_at, c.created_at, c.updated_at,
  c.version = max(c.version) over (partition by c.item_id) as latest,
  totals.total_cost, totals.total_cost / nullif(c.completed_units, 0) as final_unit_cost
from garments_erp.item_costing c
cross join lateral (
  select coalesce(sum(line.approved_amount) filter (
    where t.type is distinct from 'discount' and t.type is distinct from 'profit'
  ), 0) as total_cost
  from garments_erp.item_costing_item line
  left join garments_erp.item_costing_peripherals_type t on t.id = line.item_costing_peripherals_type_id
  where line.item_costing_id = c.id
) totals;

create function public.erp_finished_goods_choices(p_adjustment boolean)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not garments_access.has_screen_permission('finishedProducts', 'create') then
    raise exception 'Finished Products create access required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id::text, 'label', e.employee_code) order by e.employee_code)
      from garments_erp.employee e where e.is_active
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id::text, 'label', coalesce(i.style_code, i.id::text),
        'costing_finalized', exists (
          select 1 from garments_erp.item_costing c
          join garments_erp.item_costing_status s on s.id = c.item_costing_status_id
          where c.item_id = i.id and s.name = 'finalized'
        ),
        'sizes', coalesce((
          select jsonb_agg(jsonb_build_object('id', sz.id::text, 'label', sl.size) order by sl.sort_order, sz.id)
          from garments_erp.item_size_list sz join garments_erp.size_list sl on sl.id = sz.size_list_id
          where sz.item_id = i.id
        ), '[]'::jsonb),
        'jobs', coalesce((
          select jsonb_agg(jsonb_build_object('id', j.id::text, 'label', coalesce(j.job_code, j.id::text)) order by j.id)
          from garments_erp.item_part ip
          join garments_erp.production p on p.item_part_id = ip.id
          join garments_erp.job j on j.production_id = p.id and j.latest
          join garments_erp.stage st on st.id = j.stage_id
          join garments_erp.stage_type typ on typ.id = st.stage_type_id
          where ip.item_id = i.id and lower(typ.name) = 'complete'
        ), '[]'::jsonb)
      ) order by i.style_code, i.id)
      from garments_erp.item i
      where case when p_adjustment then
        exists (select 1 from garments_erp.item_produced r where r.item_id = i.id)
      else exists (select 1 from garments_erp.costing_ready_items() ready where ready.id = i.id)
        and not exists (select 1 from garments_erp.item_produced r where r.item_id = i.id)
      end
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.erp_finished_goods_choices(boolean) from public, anon, authenticated, service_role;
grant execute on function public.erp_finished_goods_choices(boolean) to authenticated;

commit;
