begin;

insert into garments_access.app_resource (key, name, resource_type)
values ('billingPacking', 'Packing Lists', 'screen');

create function public.erp_portal_create_packing_list(
  p_request_id uuid, p_billing_id bigint, p_date date, p_location text
) returns text language plpgsql security definer set search_path = '' as $$
declare
  actor bigint := garments_erp.billing_employee('billingPacking');
  packing_id bigint;
  command jsonb := jsonb_build_object('action', 'create_packing_list',
    'date', p_date, 'location', btrim(p_location));
  prior garments_erp.billing_audit%rowtype;
begin
  if not garments_access.has_screen_permission('billingPacking', 'create') then
    raise exception 'Packing list create access required' using errcode = '42501';
  end if;
  if p_request_id is null or p_date is null or nullif(btrim(p_location), '') is null then
    raise exception 'Enter a packing date and location' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into prior from garments_erp.billing_audit where request_id = p_request_id;
  if found then
    if (prior.billing_id, prior.employee_id, prior.command)
       is distinct from (p_billing_id, actor, command) then
      raise exception 'Request ID already used' using errcode = '22023';
    end if;
    return prior.after_state->>'id';
  end if;
  perform 1 from garments_erp.billing b
  join garments_erp.billing_status_type s on s.id = b.billing_status_type_id
  where b.id = p_billing_id and s.type = 'finalized' for update of b;
  if not found then raise exception 'Packing requires a finalized invoice'; end if;
  if exists (select 1 from garments_erp.packing_list where billing_id = p_billing_id) then
    raise exception 'A packing list already exists for this invoice';
  end if;

  packing_id := nextval(pg_get_serial_sequence('garments_erp.packing_list', 'id'));
  insert into garments_erp.packing_list (id, billing_id, packing_list_number, date, location_abbr)
  values (packing_id, p_billing_id, 'PL-' || lpad(packing_id::text, greatest(4, length(packing_id::text)), '0'), p_date, btrim(p_location));
  insert into garments_erp.billing_audit (request_id, billing_id, employee_id, command, after_state)
  values (p_request_id, p_billing_id, actor, command,
    (select to_jsonb(p) from garments_erp.packing_list p where p.id = packing_id));
  return packing_id::text;
end;
$$;

create function garments_erp.billing_is_packed(p_billing_id bigint)
returns boolean language sql stable set search_path = '' as $$
  select not exists (
          select 1 from garments_erp.billing_item l
          where l.billing_id = p_billing_id and (
            (l.billed_units is not null and l.billed_units <> coalesce((
              select sum(c.packed_units) from garments_erp.carton_item c where c.billing_item_id = l.id
            ), 0))
            or (l.billed_units is null and exists (
              select 1 from garments_erp.billing_item_piece_per_size s
              where s.billing_item_id = l.id and s.billed_pieces <> coalesce((
                select sum(c.packed_pieces) from garments_erp.carton_item_piece_per_size c
                where c.billing_item_piece_per_size_id = s.id
              ), 0)
            ))
          )
        ) and exists (select 1 from garments_erp.carton c
          join garments_erp.packing_list p on p.id = c.packing_list_id where p.billing_id = p_billing_id)

$$;
revoke all on function garments_erp.billing_is_packed(bigint) from public, anon, authenticated, service_role;

create function garments_erp.packing_contents(p_list_id bigint, p_carton_id bigint default null)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ci.id::text || ':' || bp.id, 'carton_id', c.id::text, 'number', c.carton_number,
    'item', i.style_code, 'size', z.size,
    'pieces', case when ci.packed_units is not null then ci.packed_units::bigint * bp.share_weight
      else part.packed_pieces end,
    'status', case when t.dispatched_at is not null then 'Dispatched'
      when t.id is not null then 'Assigned' else 'Packed' end
  ) order by c.id, ci.id, z.sort_order, bp.id), '[]')
  from garments_erp.carton c
  join garments_erp.carton_item ci on ci.carton_id = c.id
  join garments_erp.billing_item_piece_per_size bp on bp.billing_item_id = ci.billing_item_id
  join garments_erp.item_size_list sz on sz.id = bp.item_size_list_id
  join garments_erp.size_list z on z.id = sz.size_list_id
  join garments_erp.item i on i.id = sz.item_id
  left join garments_erp.carton_item_piece_per_size part
    on part.carton_item_id = ci.id and part.billing_item_piece_per_size_id = bp.id
  left join garments_erp.transport_item a on a.carton_id = c.id
  left join garments_erp.transport t on t.id = a.transport_id
  where c.packing_list_id = p_list_id and (p_carton_id is null or c.id = p_carton_id)
    and (ci.packed_units is not null or part.id is not null);
$$;
revoke all on function garments_erp.packing_contents(bigint, bigint) from public, anon, authenticated, service_role;

create function garments_erp.packing_progress(p_billing_id bigint)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('remaining', r.billed - r.packed)
    order by r.id), '[]')
  from (
    select 'set-' || l.id as id, p.name as item, 'Sets' as unit, null::text as size,
      l.billed_units as billed, coalesce(sum(ci.packed_units), 0) as packed
    from garments_erp.billing_item l
    join garments_erp.sellable_product p on p.id = l.sellable_product_id
    left join garments_erp.carton_item ci on ci.billing_item_id = l.id
    where l.billing_id = p_billing_id and l.billed_units is not null
    group by l.id, p.id
    union all
    select 'piece-' || bp.id, i.style_code, 'Pieces', z.size,
      bp.billed_pieces, coalesce(sum(part.packed_pieces), 0)
    from garments_erp.billing_item l
    join garments_erp.billing_item_piece_per_size bp on bp.billing_item_id = l.id
    join garments_erp.item_size_list sz on sz.id = bp.item_size_list_id
    join garments_erp.size_list z on z.id = sz.size_list_id
    join garments_erp.item i on i.id = sz.item_id
    left join garments_erp.carton_item_piece_per_size part on part.billing_item_piece_per_size_id = bp.id
    where l.billing_id = p_billing_id and l.billed_units is null
    group by bp.id, i.id, z.id
  ) r;
$$;
revoke all on function garments_erp.packing_progress(bigint) from public, anon, authenticated, service_role;

create function public.erp_portal_packing_lists(
  p_id bigint default null, p_billing_id bigint default null, p_search text default '',
  p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform garments_erp.billing_employee('billingPacking');
  return (
    select coalesce(jsonb_agg(to_jsonb(r) - 'sort_id' order by r.sort_id desc), '[]')
    from (
      select p.id::text, p.id as sort_id, p.billing_id::text, p.packing_list_number,
        p.date, p.location_abbr, b.invoice_number,
        (select count(*) from garments_erp.carton c where c.packing_list_id = p.id) as carton_count,
        case when garments_erp.billing_is_packed(b.id) then 'Packed' else 'Packing' end as status,
        case when p_id is not null or p_billing_id is not null
          then garments_erp.packing_progress(b.id) end as progress,
        case when p_id is not null or p_billing_id is not null
          then garments_erp.packing_contents(p.id) end as contents,
        case when p_id is not null or p_billing_id is not null then (
          select coalesce(jsonb_agg(jsonb_build_object('id', c.id::text,
            'number', c.carton_number, 'barcode', c.carton_identifier_barcode,
            'status', case when t.dispatched_at is not null then 'Dispatched'
              when t.id is not null then 'Assigned' else 'Packed' end) order by c.id), '[]')
          from garments_erp.carton c
          left join garments_erp.transport_item a on a.carton_id = c.id
          left join garments_erp.transport t on t.id = a.transport_id
          where c.packing_list_id = p.id
        ) end as cartons
      from garments_erp.packing_list p
      join garments_erp.billing b on b.id = p.billing_id
      where (p_id is null or p.id = p_id)
        and (p_billing_id is null or p.billing_id = p_billing_id)
        and (nullif(btrim(p_search), '') is null or strpos(lower(concat_ws(' ',
          p.packing_list_number, b.invoice_number, p.location_abbr)), lower(btrim(p_search))) > 0)
      order by p.id desc
      limit 51 offset greatest(coalesce(p_offset, 0), 0)
    ) r
  );
end;
$$;

revoke all on function public.erp_portal_create_packing_list(uuid, bigint, date, text),
  public.erp_portal_packing_lists(bigint, bigint, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.erp_portal_create_packing_list(uuid, bigint, date, text),
  public.erp_portal_packing_lists(bigint, bigint, text, integer) to authenticated;
notify pgrst, 'reload schema';
commit;
