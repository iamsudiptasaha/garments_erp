begin;
set local lock_timeout = '10s';

-- Freeze legacy associations and concurrent accounting edits until the copy
-- and column removal commit together. Existing item amounts are authoritative.
lock table garments_erp.transport_docket, garments_erp.transport_bill_item in access exclusive mode;

insert into garments_erp.transport_bill_item (transport_bill_id, transport_docket_id)
select transport_number_id, id
from garments_erp.transport_docket
on conflict (transport_bill_id, transport_docket_id) do nothing;

do $$
begin
  if exists (
    select 1 from garments_erp.transport_docket d
    where not exists (
      select 1 from garments_erp.transport_bill_item i
      where i.transport_docket_id = d.id and i.transport_bill_id = d.transport_number_id
    )
  ) then
    raise exception 'A historical docket-to-bill association could not be migrated';
  end if;
end;
$$;

-- RESTRICT causes an unexpected dependent object to abort the migration.
alter table garments_erp.transport_docket drop column transport_number_id restrict;
alter table garments_erp.transport_docket enable row level security;
revoke all on garments_erp.transport_docket from public, anon, authenticated;

create function public.erp_portal_create_transport(
  p_request_id uuid, p_transporter_id bigint, p_docket text, p_date date, p_cartons bigint[]
) returns text language plpgsql security definer set search_path = '' as $$
declare
  actor bigint := garments_erp.billing_employee('billingDispatch');
  screen_id bigint;
  new_id bigint;
  carton_count integer;
  details jsonb;
  prior garments_access.app_activity_log%rowtype;
begin
  if not garments_access.has_screen_permission('billingDispatch', 'create') then
    raise exception 'Transport create access required' using errcode = '42501';
  end if;
  if p_request_id is null or p_transporter_id is null or nullif(btrim(p_docket), '') is null
      or p_date is null or coalesce(cardinality(p_cartons), 0) not between 1 and 100
      or array_position(p_cartons, null) is not null then
    raise exception 'Enter a carrier, docket, pickup date and up to 100 cartons' using errcode = '22023';
  end if;
  select id into strict screen_id from garments_access.app_resource where key = 'billingDispatch';
  details := jsonb_build_object('request_id', p_request_id, 'employee_id', actor,
    'transporter_id', p_transporter_id, 'docket', btrim(p_docket), 'appointment_date', p_date,
    'carton_ids', (select jsonb_agg(id order by id) from unnest(p_cartons) id));
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 3));
  select * into prior from garments_access.app_activity_log
  where app_resource_id = screen_id and action = 'create_transport'
    and app_activity_log.details->>'request_id' = p_request_id::text;
  if found then
    if (prior.actor_user_id, prior.details) is distinct from (auth.uid(), details) then
      raise exception 'Request ID already used' using errcode = '22023';
    end if;
    return prior.target_id;
  end if;

  perform c.id
  from garments_erp.carton c
  join garments_erp.packing_list p on p.id = c.packing_list_id
  join garments_erp.billing b on b.id = p.billing_id
  join garments_erp.billing_status_type s on s.id = b.billing_status_type_id
  where c.id = any(p_cartons) and s.type = 'finalized'
  order by c.id for update of c;
  get diagnostics carton_count = row_count;
  if carton_count <> cardinality(p_cartons) or exists (
    select 1 from garments_erp.transport_item where carton_id = any(p_cartons)
  ) or exists (
    select 1 from unnest(p_cartons) as picked(id)
    where not exists (select 1 from garments_erp.carton_item ci where ci.carton_id = picked.id)
  ) then raise exception 'Select distinct, packed, unassigned cartons from finalized invoices'; end if;

  insert into garments_erp.transport (appointment_date, transporter_id, transport_status_type_id)
  values (p_date, p_transporter_id, (select id from garments_erp.transport_status_type where type = 'draft'))
  returning id into new_id;
  insert into garments_erp.transport_docket (transport_id, docket_number)
  values (new_id, btrim(p_docket));
  insert into garments_erp.transport_item (transport_id, carton_id)
  select new_id, id from unnest(p_cartons) id order by id;

  insert into garments_access.app_activity_log
    (actor_user_id, app_resource_id, action, target_type, target_id, details)
  values (auth.uid(), screen_id, 'create_transport', 'transport', new_id::text, details);
  return new_id::text;
end;
$$;

revoke all on function public.erp_portal_create_transport(uuid, bigint, text, date, bigint[])
from public, anon, authenticated, service_role;
grant execute on function public.erp_portal_create_transport(uuid, bigint, text, date, bigint[])
to authenticated;
insert into garments_access.app_resource (key, name, resource_type)
values ('billingCartons', 'Cartons', 'screen');

create function public.erp_portal_save_carton(
  p_request_id uuid, p_packing_list_id bigint, p_carton_id bigint,
  p_barcode text, p_allocations jsonb
) returns text language plpgsql security definer set search_path = '' as $$
declare
  actor bigint := garments_erp.billing_employee('billingCartons');
  action text;
  destination garments_erp.packing_list%rowtype;
  carton garments_erp.carton%rowtype;
  previous_invoice bigint;
  assigned_transport bigint;
  carton_number text;
  serial_number text;
  result_id bigint;
  command jsonb;
  prior garments_erp.billing_audit%rowtype;
begin
  if p_request_id is null or jsonb_typeof(p_allocations) is distinct from 'array' then
    raise exception 'Enter carton allocations' using errcode = '22023';
  end if;
  action := case when p_carton_id is null then 'create'
    when p_allocations = '[]'::jsonb then 'delete' else 'edit' end;
  if not garments_access.has_screen_permission('billingCartons', action) then
    raise exception 'Carton action access required' using errcode = '42501';
  end if;
  if action = 'create' and p_allocations = '[]'::jsonb then
    raise exception 'Allocate at least one billed quantity' using errcode = '22023';
  end if;

  command := jsonb_build_object('action', action || '_carton', 'packing_list_id', p_packing_list_id,
    'carton_id', p_carton_id, 'barcode', nullif(btrim(p_barcode), ''), 'allocations', p_allocations);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into prior from garments_erp.billing_audit where request_id = p_request_id;
  if found then
    if (prior.employee_id, prior.command) is distinct from (actor, command) then
      raise exception 'Request ID already used' using errcode = '22023';
    end if;
    return prior.after_state->>'id';
  end if;
  select * into strict destination from garments_erp.packing_list where id = p_packing_list_id;

  if p_carton_id is not null then
    select * into strict carton from garments_erp.carton where id = p_carton_id;
    select billing_id into strict previous_invoice from garments_erp.packing_list where id = carton.packing_list_id;
    select transport_id into assigned_transport from garments_erp.transport_item where carton_id = p_carton_id;
    if assigned_transport is not null then
      perform 1 from garments_erp.transport where id = assigned_transport and dispatched_at is null for update;
      if not found then raise exception 'Dispatched carton is immutable'; end if;
      if carton.packing_list_id <> p_packing_list_id then
        raise exception 'Remove the transport assignment before changing the packing list';
      end if;
    end if;
  end if;
  perform b.id from garments_erp.billing b
  where b.id in (destination.billing_id, previous_invoice) order by b.id for update;
  if p_carton_id is not null then
    perform 1 from garments_erp.carton c
    where c.id = p_carton_id and c.packing_list_id = carton.packing_list_id for update;
    if not found or assigned_transport is distinct from (
      select transport_id from garments_erp.transport_item where carton_id = p_carton_id
    ) then raise exception 'Carton changed. Refresh and try again' using errcode = '40001'; end if;
    if action = 'delete' and carton.packing_list_id <> p_packing_list_id then
      raise exception 'Select the carton’s current packing list' using errcode = '22023';
    end if;
    if action = 'delete' then
      delete from garments_erp.transport_item where carton_id = p_carton_id;
    elsif carton.packing_list_id <> p_packing_list_id then
      update garments_erp.carton set packing_list_id = p_packing_list_id where id = p_carton_id;
    end if;
    carton_number := carton.carton_number;
  else
    serial_number := nextval(pg_get_serial_sequence('garments_erp.carton', 'id'))::text;
    carton_number := coalesce(nullif(destination.location_abbr, ''), 'CTN') || '-' ||
      lpad(serial_number, greatest(length(serial_number), 3), '0');
    insert into garments_erp.carton (id, packing_list_id, carton_number) overriding system value
    values (serial_number::bigint, p_packing_list_id, carton_number);
  end if;

  result_id := public.erp_pack_billing_carton(destination.billing_id,
    destination.packing_list_number, carton_number, p_allocations);
  if result_id is not null then
    update garments_erp.carton set carton_identifier_barcode = nullif(btrim(p_barcode), '')
    where id = result_id;
  end if;
  insert into garments_erp.billing_audit (request_id, billing_id, employee_id, command, before_state, after_state)
  values (p_request_id, destination.billing_id, actor, command,
    case when p_carton_id is not null then to_jsonb(carton) end, jsonb_build_object('id', result_id::text));
  return result_id::text;
end;
$$;

revoke all on function public.erp_portal_save_carton(uuid, bigint, bigint, text, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.erp_portal_save_carton(uuid, bigint, bigint, text, jsonb)
to authenticated;

notify pgrst, 'reload schema';
commit;
