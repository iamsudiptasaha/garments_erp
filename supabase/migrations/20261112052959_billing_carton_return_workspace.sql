begin;

create function public.erp_portal_carton_workspace(
  p_list_id bigint default null, p_carton_id bigint default null, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform garments_erp.billing_employee('billingCartons');
  return jsonb_build_object(
    'cartons', coalesce((
      select jsonb_agg(to_jsonb(r) - 'sort_id' order by r.sort_id desc)
      from (
        select c.id::text, c.id as sort_id, c.carton_number, c.carton_identifier_barcode as barcode,
          p.packing_list_number, p.id::text as packing_id, b.invoice_number, b.id::text as billing_id,
          a.transport_id::text,
          case when t.dispatched_at is not null then 'Dispatched'
            when a.transport_id is not null then 'Assigned' else 'Packed' end as status
        from garments_erp.carton c
        join garments_erp.packing_list p on p.id = c.packing_list_id
        join garments_erp.billing b on b.id = p.billing_id
        left join garments_erp.transport_item a on a.carton_id = c.id
        left join garments_erp.transport t on t.id = a.transport_id
        where p_list_id is null and (p_carton_id is null or c.id = p_carton_id)
        order by c.id desc limit 51 offset greatest(coalesce(p_offset, 0), 0)
      ) r
    ), '[]'),
    'packing_lists', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id::text, 'label',
        concat_ws(' · ', p.packing_list_number, b.invoice_number)) order by p.id desc)
      from garments_erp.packing_list p
      join garments_erp.billing b on b.id = p.billing_id
      join garments_erp.billing_status_type s on s.id = b.billing_status_type_id
      where s.type = 'finalized' and p_list_id is null
    ), '[]'),
    'contents', case when p_carton_id is not null and p_list_id is not null
      then garments_erp.packing_contents(p_list_id, p_carton_id) else '[]' end,
    'allocations', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.line_id, r.billed_piece_id)
      from (
        select l.id::text as line_id, null::text as billed_piece_id, product.name as item,
          null::text as size, 'Sets' as unit, l.billed_units - coalesce(sum(a.packed_units)
            filter (where a.carton_id is distinct from p_carton_id), 0) as available,
          coalesce(sum(a.packed_units) filter (where a.carton_id = p_carton_id), 0) as quantity
        from garments_erp.packing_list p
        join garments_erp.billing_item l on l.billing_id = p.billing_id
        join garments_erp.sellable_product product on product.id = l.sellable_product_id
        left join garments_erp.carton_item a on a.billing_item_id = l.id
        where p.id = p_list_id and l.billed_units is not null
        group by l.id, product.id
        union all
        select l.id::text, piece.id::text, i.style_code, z.size, 'Pieces',
          piece.billed_pieces - coalesce(sum(a.packed_pieces)
            filter (where ci.carton_id is distinct from p_carton_id), 0),
          coalesce(sum(a.packed_pieces) filter (where ci.carton_id = p_carton_id), 0)
        from garments_erp.packing_list p
        join garments_erp.billing_item l on l.billing_id = p.billing_id
        join garments_erp.billing_item_piece_per_size piece on piece.billing_item_id = l.id
        join garments_erp.item_size_list sz on sz.id = piece.item_size_list_id
        join garments_erp.item i on i.id = sz.item_id
        join garments_erp.size_list z on z.id = sz.size_list_id
        left join garments_erp.carton_item_piece_per_size a on a.billing_item_piece_per_size_id = piece.id
        left join garments_erp.carton_item ci on ci.id = a.carton_item_id
        where p.id = p_list_id and l.billed_units is null
        group by l.id, piece.id, i.id, z.id
      ) r
    ), '[]')
  );
end;
$$;

create function public.erp_portal_return_workspace(
  p_invoice_id bigint default null, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor bigint := garments_erp.billing_employee('billingReturns');
begin
  return jsonb_build_object(
    'employee', (select employee_code from garments_erp.employee where id = actor),
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('id', id::text, 'name', name)
      order by name, id) from garments_erp.return_reason_type_id), '[]'),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id::text, 'label',
        concat_ws(' · ', b.invoice_number, buyer.buyer_name)) order by b.id desc)
      from garments_erp.billing b
      join garments_erp.billing_status_type s on s.id = b.billing_status_type_id
      join garments_erp.buyer_list buyer on buyer.id = b.buyer_list_id
      where s.type = 'dispatched' and p_invoice_id is null
    ), '[]'),
    'returns', coalesce((
      select jsonb_agg(to_jsonb(r) - 'sort_id' order by r.sort_id desc)
      from (
        select rb.id::text, rb.id as sort_id, rb.date, b.invoice_number,
          b.id::text as billing_id, e.employee_code as verifier, coalesce((
            select sum(case when ri.returned_units is not null then ri.returned_units * ri.unit_price else (
              select sum(rp.returned_pieces * rp.returned_price_per_piece)
              from garments_erp.return_bill_item_piece_per_size rp where rp.return_bill_item_id = ri.id
            ) end)
            from garments_erp.return_bill_item ri where ri.return_bill_id = rb.id
          ), 0) as credit,
          coalesce((
            select jsonb_agg(jsonb_build_object('id', p.id::text, 'item', i.style_code,
              'size', z.size, 'pieces', p.returned_pieces, 'price', p.returned_price_per_piece,
              'credit', p.returned_pieces * p.returned_price_per_piece) order by p.id)
            from garments_erp.return_bill_item ri
            join garments_erp.return_bill_item_piece_per_size p on p.return_bill_item_id = ri.id
            join garments_erp.item_size_list sz on sz.id = p.item_size_list_id
            join garments_erp.item i on i.id = sz.item_id
            join garments_erp.size_list z on z.id = sz.size_list_id
            where ri.return_bill_id = rb.id and ri.returned_units is null
          ), '[]') as parts
        from garments_erp.return_bill rb
        join garments_erp.billing b on b.id = rb.billing_id
        join garments_erp.employee e on e.id = rb.verified_by_id
        where rb.verified_at is not null and (p_invoice_id is null or b.id = p_invoice_id)
        order by rb.id desc limit 51 offset greatest(coalesce(p_offset, 0), 0)
      ) r
    ), '[]'),
    'remaining_credit', (select original_value - verified_credit from garments_erp.billing_value(p_invoice_id)),
    'pieces', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.line_id, r.id)
      from (
        select bp.id::text, l.id::text as line_id, i.style_code as item, z.size,
          bp.billed_pieces - coalesce((
            select sum(rp.returned_pieces)
            from garments_erp.return_bill_item_piece_per_size rp
            join garments_erp.return_bill_item ri on ri.id = rp.return_bill_item_id
            join garments_erp.return_bill rb on rb.id = ri.return_bill_id
            where rp.billing_item_piece_per_size_id = bp.id and rb.verified_at is not null
          ), 0) as remaining,
          case when l.billed_units is null then bp.price_per_piece else l.unit_price / nullif((
            select sum(share_weight) from garments_erp.billing_item_piece_per_size
            where billing_item_id = l.id
          ), 0) end as suggested_price,
          coalesce(l.unit_price, bp.price_per_piece) as price_ceiling
        from garments_erp.billing b
        join garments_erp.billing_status_type st on st.id = b.billing_status_type_id
        join garments_erp.billing_item l on l.billing_id = b.id
        join garments_erp.billing_item_piece_per_size bp on bp.billing_item_id = l.id
        join garments_erp.item_size_list sz on sz.id = bp.item_size_list_id
        join garments_erp.item i on i.id = sz.item_id
        join garments_erp.size_list z on z.id = sz.size_list_id
        where b.id = p_invoice_id and st.type = 'dispatched'
      ) r where r.remaining > 0
    ), '[]')
  );
end;
$$;

revoke all on function public.erp_portal_carton_workspace(bigint, bigint, integer),
  public.erp_portal_return_workspace(bigint, integer) from public, anon, authenticated, service_role;
grant execute on function public.erp_portal_carton_workspace(bigint, bigint, integer),
  public.erp_portal_return_workspace(bigint, integer) to authenticated;
notify pgrst, 'reload schema';
commit;
