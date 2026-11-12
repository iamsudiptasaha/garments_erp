begin;

create function public.erp_portal_buyer_po(
  p_id bigint default null, p_search text default '', p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform garments_erp.billing_employee('billingBuyerPO');
  return (
    select coalesce(jsonb_agg(to_jsonb(result) - 'sort_id' order by result.issue_date desc nulls last, result.sort_id desc), '[]')
    from (
      select h.id::text, h.id as sort_id, h.po_number, b.buyer_name as buyer, h.po_issue_date as issue_date,
        h.po_expiry_date as expiry_date, h.season, h.billing_address, h.delivery_address,
        (select count(*) from garments_erp.po_item p where p.buyer_po_id = h.id) as line_count,
        (select string_agg(distinct initcap(m.type), ', ' order by initcap(m.type))
         from garments_erp.po_item p join garments_erp.sale_mode_type m on m.id = p.sale_mode_type_id
         where p.buyer_po_id = h.id) as modes,
        case when p_id is not null then (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id::text, 'mode', m.type, 'product', product.name,
            'style', p.style_code, 'color', p.color, 'sets', p.ordered_units,
            'unit_price', p.unit_price,
            'pieces', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', s.item_size_list_id::text, 'style', i.style_code, 'size', sz.size,
                'ordered', s.pieces_ordered, 'remaining', a.remaining, 'weight', s.share_weight,
                'price', s.price_per_piece, 'fcid', s.fcid, 'hsn', s.hsn_code
              ) order by sz.sort_order, s.id)
              from garments_erp.po_item_piece_per_size s
              join garments_erp.item_size_list l on l.id = s.item_size_list_id
              join garments_erp.item i on i.id = l.item_id
              join garments_erp.size_list sz on sz.id = l.size_list_id
              left join public.erp_billing_po_allowance(p.id) a using (item_size_list_id)
              where s.po_item_id = p.id
            ), '[]')
          ) order by p.id), '[]')
          from garments_erp.po_item p
          join garments_erp.sale_mode_type m on m.id = p.sale_mode_type_id
          left join garments_erp.sellable_product product on product.id = p.sellable_product_id
          where p.buyer_po_id = h.id
        ) end as lines
      from garments_erp.buyer_po h
      join garments_erp.buyer_list b on b.id = h.buyer_list_id
      where h.po_source_type_id = garments_erp.formal_po_source_id()
        and (p_id is null or p_id = h.id)
        and (nullif(btrim(p_search), '') is null
          or strpos(lower(concat_ws(' ', h.po_number, b.buyer_name)), lower(btrim(p_search))) > 0)
      order by h.po_issue_date desc nulls last, h.id desc
      limit 51 offset greatest(coalesce(p_offset, 0), 0)
    ) result
  );
end;
$$;

create function garments_erp.billing_catalogue()
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  return (
    with sizes as (
      select s.id, i.style_code as style, l.size, stock.available
      from garments_erp.item_size_list s
      join garments_erp.item i on i.id = s.item_id
      join garments_erp.size_list l on l.id = s.size_list_id
      left join garments_erp.finished_balances(null) stock on stock.size_id = s.id
      where exists (select 1 from garments_erp.item_produced_pieces r
        where r.item_size_list_id = s.id and r.pieces > 0)
    ), products as (
      select p.id, p.name, p.sku, p.style_code as style,
        jsonb_agg(jsonb_build_object('id', s.id::text, 'style', s.style, 'size', s.size,
          'weight', u.share_weight, 'available', s.available) order by s.style, s.size, s.id) as pieces
      from garments_erp.sellable_product p
      join garments_erp.sellable_unit u on u.sellable_product_id = p.id
      left join sizes s on s.id = u.item_size_list_id
      where p.is_active and p.verified_at is not null
      group by p.id
      having count(*) = count(s.id)
    )
    select jsonb_build_object(
      'buyers', coalesce((select jsonb_agg(jsonb_build_object('id', id::text, 'name', buyer_name)
        order by buyer_name, id) from garments_erp.buyer_list), '[]'),
      'products', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('id', id::text)
        order by sku, id) from products p), '[]'),
      'sizes', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('id', id::text)
        order by style, size, id) from sizes s), '[]')
    )
  );
end;
$$;

revoke all on function garments_erp.billing_catalogue() from public, anon, authenticated, service_role;
create function public.erp_portal_buyer_po_choices()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform garments_erp.billing_employee('billingBuyerPO');
  return garments_erp.billing_catalogue();
end;
$$;

revoke all on function public.erp_portal_buyer_po(bigint, text, integer),
  public.erp_portal_buyer_po_choices() from public, anon, authenticated, service_role;
grant execute on function public.erp_portal_buyer_po(bigint, text, integer),
  public.erp_portal_buyer_po_choices() to authenticated;

notify pgrst, 'reload schema';
commit;
