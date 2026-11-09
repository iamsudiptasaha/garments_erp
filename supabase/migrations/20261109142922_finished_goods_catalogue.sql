begin;

alter table garments_erp.item_in_store_price add column price_per_piece numeric
  check (price_per_piece >= 0 and price_per_piece < 'Infinity'::numeric);

create function public.erp_finished_goods_catalogue()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not garments_access.has_screen_permission('finishedProducts', 'view') then
    raise exception 'Finished Goods view access required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id::text, 'sku', p.sku, 'name', p.name,
        'active', p.is_active, 'verified', p.verified_at is not null,
        'components', coalesce((
          select jsonb_agg(jsonb_build_object('id', u.id::text, 'item', i.style_code,
            'size', sl.size, 'pieces', u.share_weight, 'reference_cost', costing.final_unit_cost)
            order by i.style_code, sl.sort_order, u.id)
          from garments_erp.sellable_unit u
          join garments_erp.item i on i.id = u.item_id
          join garments_erp.item_size_list sz on sz.id = u.item_size_list_id
          join garments_erp.size_list sl on sl.id = sz.size_list_id
          left join lateral (
            select summary.final_unit_cost
            from garments_erp.item_costing_summary summary
            join garments_erp.item_costing header on header.id = summary.id
            join garments_erp.item_costing_status status on status.id = summary.item_costing_status_id
            where summary.item_id = i.id and header.item_produced_id is not null
              and status.name = 'finalized'
            order by summary.version desc limit 1
          ) costing on true
          where u.sellable_product_id = p.id
        ), '[]'::jsonb)) order by p.sku, p.id)
      from garments_erp.sellable_product p
    ), '[]'::jsonb),
    'prices', coalesce((
      select jsonb_agg(jsonb_build_object('id', price.id::text, 'product', product.sku,
        'type', t.name, 'version', price.version, 'price_per_piece', price.price_per_piece,
        'date', price.date) order by price.date desc nulls last, price.id desc)
      from garments_erp.item_in_store_price price
      join garments_erp.sellable_product product on product.id = price.sellable_product_id
      join garments_erp.price_type t on t.id = price.price_type_id
    ), '[]'::jsonb),
    'types', coalesce((
      select jsonb_agg(jsonb_build_object('id', id::text, 'name', name,
        'description', description) order by name, id)
      from garments_erp.price_type
    ), '[]'::jsonb),
    'sizes', coalesce((
      select jsonb_agg(jsonb_build_object('id', sz.id::text, 'item', i.style_code,
        'size', sl.size) order by i.style_code, sl.sort_order, sz.id)
      from garments_erp.item_size_list sz
      join garments_erp.item i on i.id = sz.item_id
      join garments_erp.size_list sl on sl.id = sz.size_list_id
      where exists (select 1 from garments_erp.item_produced receipt where receipt.item_id = i.id)
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object('id', id::text, 'label', employee_code) order by employee_code)
      from garments_erp.employee
      where is_active and garments_access.has_screen_permission('finishedProducts', 'create')
    ), '[]'::jsonb)
  );
end;
$$;

create function public.erp_create_finished_catalogue_entry(p_kind text, p_entry jsonb)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  entry_id bigint;
  expected integer;
  written integer;
begin
  if not garments_access.has_screen_permission('finishedProducts', 'create') then
    raise exception 'Finished Goods create access required' using errcode = '42501';
  end if;
  case p_kind
    when 'priceTypes' then
      if nullif(trim(p_entry->>'name'), '') is null then raise exception 'Enter a price type name'; end if;
      insert into garments_erp.price_type(name, description)
      values (trim(p_entry->>'name'), nullif(trim(p_entry->>'description'), ''))
      returning id into entry_id;
    when 'prices' then
      if nullif(trim(p_entry->>'version'), '') is null or p_entry->>'price_per_piece' is null
        or p_entry->>'date' is null then raise exception 'Enter version, per-piece price and date'; end if;
      perform 1 from garments_erp.sellable_product
      where id = (p_entry->>'product_id')::bigint and is_active and verified_at is not null
      for share;
      if not found then raise exception 'Select an active verified sellable product'; end if;
      insert into garments_erp.item_in_store_price(sellable_product_id, price_type_id, version, price_per_piece, date)
      values ((p_entry->>'product_id')::bigint, (p_entry->>'type_id')::bigint,
        trim(p_entry->>'version'), (p_entry->>'price_per_piece')::numeric, (p_entry->>'date')::date)
      returning id into entry_id;
    when 'products' then
      if nullif(trim(p_entry->>'sku'), '') is null or nullif(trim(p_entry->>'name'), '') is null
        or p_entry->>'employee_id' is null then raise exception 'Enter SKU, name and verifying employee'; end if;
      expected := jsonb_array_length(p_entry->'components');
      if coalesce(expected, 0) < 1 or expected > 100 then raise exception 'Select 1 to 100 components'; end if;
      insert into garments_erp.sellable_product(sku, name, style_code, date)
      values (trim(p_entry->>'sku'), trim(p_entry->>'name'), nullif(trim(p_entry->>'style_code'), ''),
        nullif(p_entry->>'date', '')::date)
      returning id into entry_id;
      insert into garments_erp.sellable_unit(sellable_product_id, item_id, item_size_list_id, share_weight)
      select entry_id, size.item_id, size.id, component.pieces
      from jsonb_to_recordset(p_entry->'components') component(size_id bigint, pieces integer)
      join garments_erp.item_size_list size on size.id = component.size_id;
      get diagnostics written = row_count;
      if written <> expected then raise exception 'Select valid item sizes'; end if;
      update garments_erp.sellable_product set verified_by_employee_id = (p_entry->>'employee_id')::bigint
      where id = entry_id;
    else raise exception 'Unknown Finished Goods entry';
  end case;
  return entry_id::text;
end;
$$;

revoke all on function public.erp_finished_goods_catalogue(),
  public.erp_create_finished_catalogue_entry(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.erp_finished_goods_catalogue(),
  public.erp_create_finished_catalogue_entry(text, jsonb) to authenticated;

create function public.erp_finished_goods_summary(p_sku text, p_limit integer, p_offset integer)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  warehouse jsonb;
begin
  if not garments_access.has_screen_permission('finishedProducts', 'view') then
    raise exception 'Finished Goods view access required' using errcode = '42501';
  end if;
  warehouse := garments_erp.finished_stock(null, p_sku, null, p_limit, p_offset);
  return jsonb_build_object(
    'sizes', coalesce((
      select jsonb_agg(row || jsonb_build_object('style_code', i.style_code, 'size', sl.size,
        'total_produced', coalesce(output.pieces, 0), 'held', coalesce(billing.held, 0),
        'sold', coalesce(billing.sold, 0), 'returned',
        (row->>'available')::numeric - (row->>'produced')::numeric - (row->>'adjusted')::numeric
          + coalesce(billing.held, 0) + coalesce(billing.sold, 0)) order by i.id, sl.sort_order, sz.id)
      from jsonb_array_elements(warehouse->'sizes') row
      join garments_erp.item_size_list sz on sz.id = (row->>'size_id')::bigint
      join garments_erp.item i on i.id = sz.item_id
      join garments_erp.size_list sl on sl.id = sz.size_list_id
      left join garments_erp.billing_quantities_by_size billing on billing.item_size_list_id = sz.id
      left join lateral (
        select min(coalesce(part.pieces, 0)) as pieces
        from garments_erp.item_part ip
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
        ) part on true
        where ip.item_id = i.id
      ) output on true
    ), '[]'::jsonb),
    'variations', coalesce((
      select jsonb_agg(row || jsonb_build_object('style_code', product.style_code, 'size', recipe.sizes,
        'item_type', orders.types, 'ordered', coalesce(orders.remaining, 0),
        'held', coalesce(invoices.held, 0), 'sold', coalesce(invoices.sold, 0),
        'delivered', coalesce(invoices.delivered, 0), 'available_percent',
        round(100 * (row->>'capacity')::numeric / nullif((row->>'produced_sets')::numeric, 0), 2)
      ) order by product.id)
      from jsonb_array_elements(warehouse->'variations') row
      join garments_erp.sellable_product product on product.id = (row->>'id')::bigint
      left join lateral (
        select string_agg(size.size, '-' order by size.sort_order, size.id) as sizes
        from garments_erp.size_list size
        where exists (
          select 1 from garments_erp.sellable_unit u
          join garments_erp.item_size_list sz on sz.id = u.item_size_list_id
          where u.sellable_product_id = product.id and sz.size_list_id = size.id
        )
      ) recipe on true
      left join lateral (
        select sum(line.billed_units) filter (where status.type = 'draft') as held,
          sum(line.billed_units) filter (where status.type in ('finalized', 'dispatched')) as sold,
          sum(line.billed_units) filter (where status.type = 'dispatched') as delivered
        from garments_erp.billing_item line
        join garments_erp.billing bill on bill.id = line.billing_id
        join garments_erp.billing_status_type status on status.id = bill.billing_status_type_id
        where line.sellable_product_id = product.id
      ) invoices on true
      left join lateral (
        select string_agg(distinct kind.product_type, ', ' order by kind.product_type) as types,
          sum(greatest(po.ordered_units - coalesce(dispatched.units, 0), 0))
            filter (where header.cancelled_at is null and header.po_source_type_id = garments_erp.formal_po_source_id()) as remaining
        from garments_erp.po_item po
        join garments_erp.buyer_po header on header.id = po.buyer_po_id
        left join garments_erp.product_type_list kind on kind.id = po.product_type_list_id
        left join lateral (
          select sum(line.billed_units) as units
          from garments_erp.billing_item line
          join garments_erp.billing bill on bill.id = line.billing_id
          join garments_erp.billing_status_type status on status.id = bill.billing_status_type_id
          where line.po_item_id = po.id and status.type = 'dispatched'
        ) dispatched on true
        where po.sellable_product_id = product.id
      ) orders on true
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.erp_finished_goods_summary(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.erp_finished_goods_summary(text, integer, integer) to authenticated;

create function public.erp_finished_goods_movements(p_adjustment boolean, p_limit integer, p_offset integer)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not garments_access.has_screen_permission('finishedProducts', 'view') then
    raise exception 'Finished Goods view access required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset < 0 then
    raise exception 'Invalid pagination';
  end if;

  if p_adjustment then
    return (
      select coalesce(jsonb_agg(jsonb_build_object('id', row.id::text,
        'item', i.style_code || ' · ' || sl.size, 'delta', row.quantity_delta,
        'reason', row.reason, 'employee', e.employee_code) order by row.id desc), '[]'::jsonb)
      from (select * from garments_erp.stock_adjustment order by id desc limit p_limit offset p_offset) row
      join garments_erp.item i on i.id = row.item_id
      join garments_erp.item_size_list sz on sz.id = row.item_size_list_id
      join garments_erp.size_list sl on sl.id = sz.size_list_id
      join garments_erp.employee e on e.id = row.verified_by
    );
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', row.id::text,
      'item', i.style_code, 'pieces', pieces.total, 'employee', e.employee_code,
      'verified_at', row.verified_at) order by row.id desc), '[]'::jsonb)
    from (select * from garments_erp.item_produced order by id desc limit p_limit offset p_offset) row
    join garments_erp.item i on i.id = row.item_id
    join garments_erp.employee e on e.id = row.verified_by
    cross join lateral (
      select sum(p.pieces) as total from garments_erp.item_produced_pieces p where p.item_produced_id = row.id
    ) pieces
  );
end;
$$;

revoke all on function public.erp_finished_goods_movements(boolean, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.erp_finished_goods_movements(boolean, integer, integer) to authenticated;

commit;
