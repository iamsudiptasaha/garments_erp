begin;

create view garments_erp.fabric_plan_requirements with (security_invoker = true) as
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
  v.item_part_id, item_part.item_id, v.variant_id, v.lab_dip_id,
  h.root_item_part_id, h.production_id, plan.pieces as planned_pieces,
  plan.pieces * f.consumption_per_piece_kg as required_kg,
  coalesce(issues.kg, 0) as consumed_kg
from garments_erp.item_part_fabric f
join garments_erp.variant_item v on v.id = f.variant_item_id
join garments_erp.item_part item_part on item_part.id = v.item_part_id
join garments_erp.item_part_production_root h on h.item_part_id = v.item_part_id
join planned_pieces plan on plan.id = v.id
left join lateral (
  select sum(o.quantity) as kg
  from garments_erp.raw_material_check_out o
  join garments_erp.raw_material_check_in r on r.id = o.raw_material_check_in_id
  join garments_erp.dyed_fabric_item d on d.id = r.dyed_fabric_item_id
  join garments_erp.dyeing_program_item p on p.id = d.dyeing_program_item_id
  where o.variant_item_id = f.variant_item_id and not o.reconciliation
    and p.fabric_type_id = f.fabric_type_id
) issues on true;

create view garments_erp.fabric_plan_dyeing_quantities with (security_invoker = true) as
select p.id as dyeing_program_item_id,
  greatest(coalesce(p.quantity, 0), 0) as ordered_kg,
  coalesce(sum(d.final_quantity) filter (where b.verified_by_employee_id is not null
    and d.final_quantity > 0 and d.final_quantity < 'Infinity'::numeric), 0) as received_kg
from garments_erp.dyeing_program_item p
left join garments_erp.dyed_fabric_item d on d.dyeing_program_item_id = p.id
left join garments_erp.dyed_fabric_bill b on b.id = d.dyed_fabric_bill_id
group by p.id, p.quantity;

-- Allocate virtual quantities across the entire link graph before applying any
-- caller filters. Small requirements go first and less-shared supplies are
-- used first, so a single dyeing line cannot be counted for multiple plans.
create function garments_erp.fabric_plan_coverage(p_received boolean)
returns table (item_part_fabric_id bigint, dyeing_program_item_id bigint, estimated_kg numeric)
language plpgsql stable set search_path = '' as $$
declare
  remaining_by_program jsonb;
  requirement record;
  supply record;
  required_remaining numeric;
  supply_remaining numeric;
begin
  select coalesce(jsonb_object_agg(q.dyeing_program_item_id,
    case when p_received then q.received_kg else q.ordered_kg end), '{}'::jsonb)
  into remaining_by_program
  from garments_erp.fabric_plan_dyeing_quantities q
  where exists (
    select 1 from garments_erp.fabric_plan_dyeing_link l
    where l.dyeing_program_item_id = q.dyeing_program_item_id
  );

  for requirement in
    select r.id, r.required_kg from garments_erp.fabric_plan_requirements r
    where r.required_kg > 0 order by r.required_kg, r.id
  loop
    required_remaining := requirement.required_kg;
    for supply in
      select l.dyeing_program_item_id from garments_erp.fabric_plan_dyeing_link l
      where l.item_part_fabric_id = requirement.id
      order by (
        select count(*) from garments_erp.fabric_plan_dyeing_link other
        where other.dyeing_program_item_id = l.dyeing_program_item_id
      ), l.dyeing_program_item_id
    loop
      supply_remaining := (remaining_by_program ->> supply.dyeing_program_item_id::text)::numeric;
      if supply_remaining > 0 then
        item_part_fabric_id := requirement.id;
        dyeing_program_item_id := supply.dyeing_program_item_id;
        estimated_kg := least(required_remaining, supply_remaining);
        remaining_by_program := jsonb_set(remaining_by_program, array[supply.dyeing_program_item_id::text],
          to_jsonb(supply_remaining - estimated_kg));
        required_remaining := required_remaining - estimated_kg;
        return next;
        exit when required_remaining = 0;
      end if;
    end loop;
  end loop;
end $$;

create view garments_erp.fabric_plan_estimates with (security_invoker = true) as
with ordered as (
  select item_part_fabric_id, sum(estimated_kg) as kg
  from garments_erp.fabric_plan_coverage(false) group by item_part_fabric_id
), received as (
  select item_part_fabric_id, sum(estimated_kg) as kg
  from garments_erp.fabric_plan_coverage(true) group by item_part_fabric_id
)
select r.*, coalesce(o.kg, 0) as estimated_ordered_kg,
  coalesce(a.kg, 0) as estimated_received_kg,
  r.required_kg - coalesce(o.kg, 0) as order_shortage_kg,
  r.required_kg - coalesce(a.kg, 0) as receipt_shortage_kg
from garments_erp.fabric_plan_requirements r
left join ordered o on o.item_part_fabric_id = r.id
left join received a on a.item_part_fabric_id = r.id;

create view garments_erp.fabric_plan_dyeing_surplus with (security_invoker = true) as
with ordered as (
  select dyeing_program_item_id, sum(estimated_kg) as kg
  from garments_erp.fabric_plan_coverage(false) group by dyeing_program_item_id
), received as (
  select dyeing_program_item_id, sum(estimated_kg) as kg
  from garments_erp.fabric_plan_coverage(true) group by dyeing_program_item_id
)
select q.*, q.ordered_kg - coalesce(o.kg, 0) as ordered_surplus_kg,
  q.received_kg - coalesce(a.kg, 0) as received_surplus_kg
from garments_erp.fabric_plan_dyeing_quantities q
left join ordered o using (dyeing_program_item_id)
left join received a using (dyeing_program_item_id);

revoke all on garments_erp.fabric_plan_requirements, garments_erp.fabric_plan_dyeing_quantities,
  garments_erp.fabric_plan_estimates, garments_erp.fabric_plan_dyeing_surplus from public, anon, authenticated;
revoke execute on function garments_erp.fabric_plan_coverage(boolean) from public, anon, authenticated;

commit;
