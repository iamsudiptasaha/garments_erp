begin;

create function public.erp_finished_stock_valuation(p_limit integer, p_offset integer)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not garments_access.has_screen_permission('finishedProducts', 'view') then
    raise exception 'Finished Products view access required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset < 0 then
    raise exception 'Invalid pagination';
  end if;

  return (
    with awaiting_dispatch as (
      select piece.item_size_list_id, sum(piece.billed_pieces) as pieces
      from garments_erp.billing_item_piece_per_size piece
      join garments_erp.billing_item line on line.id = piece.billing_item_id
      join garments_erp.billing bill on bill.id = line.billing_id
      join garments_erp.billing_status_type status on status.id = bill.billing_status_type_id
      where status.type = 'finalized'
      group by piece.item_size_list_id
    ), stock as (
      select balance.item_id,
        sum(balance.available + coalesce(billing.held, 0) + coalesce(pending.pieces, 0)) as pieces,
        string_agg(size.size::text, '-' order by size.sort_order, size.id) as sizes,
        (array_agg(size.size::text order by size.sort_order, size.id))[1] as first_size,
        (array_agg(size.size::text order by size.sort_order desc, size.id desc))[1] as last_size
      from garments_erp.finished_balances(null) balance
      join garments_erp.item_size_list item_size on item_size.id = balance.size_id
      join garments_erp.size_list size on size.id = item_size.size_list_id
      left join garments_erp.billing_quantities_by_size billing on billing.item_size_list_id = balance.size_id
      left join awaiting_dispatch pending on pending.item_size_list_id = balance.size_id
      group by balance.item_id
      having sum(balance.available + coalesce(billing.held, 0) + coalesce(pending.pieces, 0)) <> 0
      order by balance.item_id limit p_limit offset p_offset
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', stock.item_id::text,
      'style_code', item.style_code,
      'size', case when stock.first_size = stock.last_size then stock.sizes
        else stock.first_size || '-' || stock.last_size end,
      'pieces', stock.pieces,
      'base_price', costing.final_unit_cost,
      'stock_value', stock.pieces * costing.final_unit_cost
    ) order by stock.item_id), '[]'::jsonb)
    from stock
    join garments_erp.item item on item.id = stock.item_id
    left join lateral (
      select summary.final_unit_cost
      from garments_erp.item_costing_summary summary
      join garments_erp.item_costing header on header.id = summary.id
      join garments_erp.item_produced receipt on receipt.id = header.item_produced_id
        and receipt.item_id = stock.item_id
      join garments_erp.item_costing_status status on status.id = summary.item_costing_status_id
      where summary.item_id = stock.item_id and status.name = 'finalized'
      order by summary.version desc limit 1
    ) costing on true
  );
end;
$$;

revoke all on function public.erp_finished_stock_valuation(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.erp_finished_stock_valuation(integer, integer) to authenticated;

commit;
