create or replace function public.erp_portal_dispatch_workspace(p_offset integer default 0, p_transport_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform garments_erp.billing_employee('billingDispatch');
  return jsonb_build_object(
    'transports', coalesce((
      select jsonb_agg(to_jsonb(r) - 'sort_id' order by r.sort_id desc)
      from (
        select t.id::text, t.id as sort_id, t.appointment_date, c.company_name as carrier,
          d.id::text as docket_id, d.docket_number, case when t.dispatched_at is null then 'Planned' else 'Dispatched' end as status,
          (select count(*) from garments_erp.transport_item a where a.transport_id = t.id) as carton_count,
          coalesce((
            select jsonb_agg(jsonb_build_object('id', carton.id::text, 'number', carton.carton_number, 'packing_id', p.id::text,
              'invoice', b.invoice_number, 'billing_id', b.id::text,
              'packing', case when garments_erp.billing_is_packed(b.id) then 'Packed' else 'Incomplete' end) order by carton.id)
            from garments_erp.transport_item a
            join garments_erp.carton carton on carton.id = a.carton_id
            join garments_erp.packing_list p on p.id = carton.packing_list_id
            join garments_erp.billing b on b.id = p.billing_id
            where a.transport_id = t.id
          ), '[]') as cartons
        from garments_erp.transport t
        join garments_erp.transporter carrier on carrier.id = t.transporter_id
        join garments_erp.contacts c on c.id = carrier.contacts_id
        left join garments_erp.transport_docket d on d.transport_id = t.id
        where p_transport_id is null or t.id = p_transport_id
        order by t.id desc limit 51 offset greatest(coalesce(p_offset, 0), 0)
      ) r
    ), '[]'),
    'carriers', case when garments_access.has_screen_permission('billingDispatch', 'create') then coalesce((
      select jsonb_agg(jsonb_build_object('id', carrier.id::text, 'name', c.company_name)
        order by c.company_name, carrier.id)
      from garments_erp.transporter carrier
      join garments_erp.contacts c on c.id = carrier.contacts_id
    ), '[]') else '[]' end,
    'available_cartons', case when garments_access.has_screen_permission('billingDispatch', 'create') then coalesce((
      select jsonb_agg(jsonb_build_object('id', carton.id::text, 'number', carton.carton_number, 'packing_id', p.id::text,
        'invoice', b.invoice_number) order by carton.carton_number, carton.id)
      from garments_erp.carton carton
      join garments_erp.packing_list p on p.id = carton.packing_list_id
      join garments_erp.billing b on b.id = p.billing_id
      join garments_erp.billing_status_type s on s.id = b.billing_status_type_id
      where s.type = 'finalized'
        and exists (select 1 from garments_erp.carton_item ci where ci.carton_id = carton.id)
        and not exists (select 1 from garments_erp.transport_item a where a.carton_id = carton.id)
    ), '[]') else '[]' end
  );
end;
$$;

-- Transport bills are independent of dockets. This command records the bill header.
create function public.erp_portal_create_transport_bill(
  p_request_id uuid, p_invoice_number text, p_invoice_date date
) returns text language plpgsql security definer set search_path = '' as $$
declare
  actor bigint := garments_erp.billing_employee('billingDispatch');
  screen_id bigint;
  bill_id bigint;
  command jsonb;
  prior garments_access.app_activity_log%rowtype;
begin
  if not garments_access.has_screen_permission('billingDispatch', 'create') then
    raise exception 'Transport bill creation access required' using errcode = '42501';
  end if;
  if p_request_id is null or nullif(btrim(p_invoice_number), '') is null or p_invoice_date is null then
    raise exception 'Enter an invoice number and date' using errcode = '22023';
  end if;
  select id into strict screen_id from garments_access.app_resource where key = 'billingDispatch';
  command := jsonb_build_object('request_id', p_request_id, 'employee_id', actor,
    'invoice_number', btrim(p_invoice_number), 'invoice_date', p_invoice_date);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 4));
  select * into prior from garments_access.app_activity_log
  where app_resource_id = screen_id and action = 'create_transport_bill'
    and details->>'request_id' = p_request_id::text;
  if found then
    if (prior.actor_user_id, prior.details) is distinct from (auth.uid(), command) then
      raise exception 'Request ID already used' using errcode = '22023';
    end if;
    return prior.target_id;
  end if;
  insert into garments_erp.transport_bill (invoice_number, invoice_date)
  values (btrim(p_invoice_number), p_invoice_date) returning id into bill_id;
  insert into garments_access.app_activity_log
    (actor_user_id, app_resource_id, action, target_type, target_id, details)
  values (auth.uid(), screen_id, 'create_transport_bill', 'transport_bill', bill_id::text, command);
  return bill_id::text;
end;
$$;
revoke all on function public.erp_portal_create_transport_bill(uuid,text,date)
from public, anon, authenticated, service_role;
grant execute on function public.erp_portal_create_transport_bill(uuid,text,date) to authenticated;
