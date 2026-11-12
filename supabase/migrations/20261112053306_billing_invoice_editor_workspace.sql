begin;

insert into garments_access.app_resource (key, name, resource_type, sort_order)
values ('section:billing', 'Billing', 'section', 61);

update garments_access.app_resource resource
set name = page.name, sort_order = page.position,
    route = '/fabric.html#' || page.key, parent_resource_id = section.id
from (values
    ('billingSummary', 'Billing Summary', 62),
    ('billingBuyerPO', 'Buyer PO', 63),
    ('billingInvoices', 'Invoices', 64),
    ('billingPacking', 'Packing Lists', 65),
    ('billingCartons', 'Cartons', 66),
    ('billingDispatch', 'Dispatch / Transport', 67),
    ('billingReturns', 'Returns', 68)
) as page(key, name, position)
cross join garments_access.app_resource section
where resource.key = page.key and section.key = 'section:billing';

create function public.erp_portal_invoice_choices(p_po_id bigint default null, p_invoice_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform garments_erp.billing_employee('billingInvoices');
  if not garments_access.has_screen_permission('billingInvoices',
    case when p_invoice_id is null then 'create' else 'edit' end) then
    raise exception 'Invoice action access required' using errcode = '42501';
  end if;
  return case when p_po_id is null then garments_erp.billing_catalogue() || jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object('id', po.id::text, 'number', po.po_number,
        'buyer', buyer.buyer_name) order by po.po_issue_date desc nulls last, po.id desc)
      from garments_erp.buyer_po po
      join garments_erp.buyer_list buyer on buyer.id = po.buyer_list_id
      where po.po_source_type_id = garments_erp.formal_po_source_id() and po.cancelled_at is null
    ), '[]'),
    'types', coalesce((
      select jsonb_agg(jsonb_build_object('id', id::text, 'name', product_type) order by product_type, id)
      from garments_erp.product_type_list
    ), '[]')
  ) else jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id::text, 'mode', m.type, 'unit_price', l.unit_price,
        'label', coalesce(product.name, l.style_code, 'PO item ' || l.id),
        'pieces', coalesce((
          select jsonb_agg(jsonb_build_object('id', p.item_size_list_id::text,
            'style', item.style_code, 'size', z.size, 'weight', p.share_weight,
            'available', stock.available + coalesce(held.pieces, 0),
            'remaining', allowance.remaining + coalesce(held.order_pieces, 0),
            'hsn', p.hsn_code, 'fcid', p.fcid, 'price', p.price_per_piece) order by p.id)
          from garments_erp.po_item_piece_per_size p
          join garments_erp.item_size_list size on size.id = p.item_size_list_id
          join garments_erp.item item on item.id = size.item_id
          join garments_erp.size_list z on z.id = size.size_list_id
          left join garments_erp.finished_balances(null) stock on stock.size_id = size.id
          left join public.erp_billing_po_allowance(l.id) allowance on allowance.item_size_list_id = size.id
          left join lateral (
            select sum(bp.billed_pieces) as pieces,
              sum(bp.billed_pieces) filter (where bi.po_item_id = l.id) as order_pieces
            from garments_erp.billing_item bi
            join garments_erp.billing_item_piece_per_size bp on bp.billing_item_id = bi.id
            where bi.billing_id = p_invoice_id and bp.item_size_list_id = size.id
          ) held on true
          where p.po_item_id = l.id
        ), '[]')
      ) order by l.id)
      from garments_erp.buyer_po po
      join garments_erp.po_item l on l.buyer_po_id = po.id
      join garments_erp.sale_mode_type m on m.id = l.sale_mode_type_id
      left join garments_erp.sellable_product product on product.id = l.sellable_product_id
      where po.id = p_po_id and po.po_source_type_id = garments_erp.formal_po_source_id()
    ), '[]')
  ) end;
end;
$$;

revoke all on function public.erp_portal_invoice_choices(bigint, bigint) from public, anon, authenticated, service_role;
grant execute on function public.erp_portal_invoice_choices(bigint, bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
