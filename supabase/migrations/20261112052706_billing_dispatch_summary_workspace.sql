begin;

insert into garments_access.app_resource (key, name, resource_type)
values ('billingSummary', 'Billing Summary', 'screen');

create function public.erp_portal_dispatch_workspace(p_offset integer default 0, p_transport_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform garments_erp.billing_employee('billingDispatch');
  return jsonb_build_object(
    'transports', coalesce((
      select jsonb_agg(to_jsonb(r) - 'sort_id' order by r.sort_id desc)
      from (
        select t.id::text, t.id as sort_id, t.appointment_date, c.company_name as carrier,
          d.docket_number, case when t.dispatched_at is null then 'Planned' else 'Dispatched' end as status,
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

create function public.erp_portal_billing_summary(p_search text default '', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform garments_erp.billing_employee('billingSummary');
  return jsonb_build_object(
    'totals', (
      select jsonb_build_object('original_value', coalesce(sum(v.original_value), 0),
        'verified_credit', coalesce(sum(v.verified_credit), 0),
        'taxable_value', coalesce(sum(v.taxable_value), 0))
      from garments_erp.billing b
      join garments_erp.billing_status_type s on s.id = b.billing_status_type_id
      cross join lateral garments_erp.billing_value(b.id) v
      where s.type in ('finalized', 'dispatched')
    ),
    'statuses', (
      select jsonb_object_agg(type, count)
      from (
        select s.type, count(b.id)
        from garments_erp.billing_status_type s
        left join garments_erp.billing b on b.billing_status_type_id = s.id
        group by s.type
      ) counts
    ),
    'stock', coalesce((
      select jsonb_agg(to_jsonb(r) - 'sort_id' order by r.style, r.size_order, r.sort_id)
      from (
        select b.size_id::text as id, b.size_id as sort_id, i.style_code as style,
          z.size, z.sort_order as size_order, b.produced, b.available
        from garments_erp.finished_balances(null) b
        join garments_erp.item i on i.id = b.item_id
        join garments_erp.item_size_list l on l.id = b.size_id
        join garments_erp.size_list z on z.id = l.size_list_id
        where b.produced > 0
          and (nullif(btrim(p_search), '') is null
            or strpos(lower(concat_ws(' ', i.style_code, z.size)), lower(btrim(p_search))) > 0)
        order by i.style_code, z.sort_order, b.size_id
        limit 51 offset greatest(coalesce(p_offset, 0), 0)
      ) r
    ), '[]')
  );
end;
$$;

revoke all on function public.erp_portal_dispatch_workspace(integer, bigint),
  public.erp_portal_billing_summary(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.erp_portal_dispatch_workspace(integer, bigint),
  public.erp_portal_billing_summary(text, integer) to authenticated;
notify pgrst, 'reload schema';
commit;
