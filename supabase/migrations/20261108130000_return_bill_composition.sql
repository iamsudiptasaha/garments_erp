begin;
set local lock_timeout = '10s';

create table garments_erp.return_mode_type (
  id bigint generated always as identity primary key,
  type text not null unique check (type in ('set', 'piece'))
);
insert into garments_erp.return_mode_type (type) values ('set'), ('piece');

alter table garments_erp.return_bill_item
  add column billing_item_id bigint references garments_erp.billing_item,
  add column return_mode_type_id bigint references garments_erp.return_mode_type,
  add column sellable_product_id bigint references garments_erp.sellable_product,
  add column returned_units integer check (returned_units > 0),
  add column unit_price numeric check (unit_price >= 0 and unit_price < 'Infinity'::numeric),
  add check ((returned_units is null and unit_price is null and sellable_product_id is null)
    or (returned_units is not null and unit_price is not null and sellable_product_id is not null));

create table garments_erp.return_bill_item_piece_per_size (
  id bigint generated always as identity primary key,
  return_bill_item_id bigint not null references garments_erp.return_bill_item,
  billing_item_piece_per_size_id bigint not null references garments_erp.billing_item_piece_per_size,
  item_size_list_id bigint not null references garments_erp.item_size_list,
  share_weight integer check (share_weight > 0),
  returned_pieces integer not null check (returned_pieces > 0),
  returned_price_per_piece numeric check (
    returned_price_per_piece >= 0 and returned_price_per_piece < 'Infinity'::numeric),
  check ((share_weight is null) <> (returned_price_per_piece is null)),
  unique (return_bill_item_id, billing_item_piece_per_size_id)
);
create index on garments_erp.return_bill_item_piece_per_size (billing_item_piece_per_size_id);

-- Retain the original line ID, reason, and timestamps for each legacy piece return.
insert into garments_erp.return_bill_item_piece_per_size
  (return_bill_item_id, billing_item_piece_per_size_id, item_size_list_id, returned_pieces, returned_price_per_piece)
select ri.id, bp.id, bp.item_size_list_id, ri.returned_pieces::integer, ri.returned_price_per_piece
from garments_erp.return_bill_item ri
join garments_erp.billing_item_piece_per_size bp on bp.id = ri.billing_item_piece_per_size_id;

alter table garments_erp.return_bill_item disable trigger zz_stamp_updated_at;
update garments_erp.return_bill_item ri
set billing_item_id = bp.billing_item_id,
    return_mode_type_id = (select id from garments_erp.return_mode_type where type = 'piece')
from garments_erp.billing_item_piece_per_size bp where bp.id = ri.billing_item_piece_per_size_id;
alter table garments_erp.return_bill_item enable trigger zz_stamp_updated_at;

alter table garments_erp.return_bill_item
  alter column billing_item_id set not null,
  alter column return_mode_type_id set not null,
  drop column billing_item_piece_per_size_id,
  drop column returned_pieces,
  drop column returned_price_per_piece;

alter table garments_erp.return_mode_type enable row level security;
alter table garments_erp.return_bill_item_piece_per_size enable row level security;
revoke all on garments_erp.return_mode_type, garments_erp.return_bill_item_piece_per_size
  from public, anon, authenticated, service_role;
grant select on garments_erp.return_mode_type, garments_erp.return_bill_item_piece_per_size to service_role;

create or replace function garments_erp.finished_balances(p_item_id bigint)
returns table (item_id bigint, size_id bigint, produced bigint, adjusted bigint, available bigint)
language sql stable set search_path = '' as $$
  select s.item_id, s.id, coalesce(p.pieces, 0), coalesce(a.delta, 0),
    coalesce(p.pieces, 0) + coalesce(a.delta, 0)
      - coalesce(b.sold, 0) - coalesce(b.held, 0) + coalesce(r.pieces, 0)
  from garments_erp.item_size_list s
  left join (
    select item_size_list_id, sum(pieces) as pieces
    from garments_erp.item_produced_pieces group by item_size_list_id
  ) p on p.item_size_list_id = s.id
  left join (
    select item_size_list_id, sum(quantity_delta) as delta
    from garments_erp.stock_adjustment group by item_size_list_id
  ) a on a.item_size_list_id = s.id
  left join garments_erp.billing_quantities_by_size b on b.item_size_list_id = s.id
  left join (
    select bp.item_size_list_id, sum(ri.returned_pieces)::bigint as pieces
    from garments_erp.return_bill_item_piece_per_size ri
    join garments_erp.return_bill_item line on line.id = ri.return_bill_item_id
    join garments_erp.return_bill rb on rb.id = line.return_bill_id
    join garments_erp.billing_item_piece_per_size bp on bp.id = ri.billing_item_piece_per_size_id
    where rb.verified_at is not null
    group by bp.item_size_list_id
  ) r on r.item_size_list_id = s.id
  where p_item_id is null or s.item_id = p_item_id;
$$;

create or replace function garments_erp.finished_stock(
  p_item_id bigint, p_sku text, p_variation_id bigint, p_limit integer, p_offset integer
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not garments_access.has_screen_permission('finishedProducts', 'view') then
    raise exception 'Finished Products view access required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset < 0
  then raise exception 'Invalid pagination'; end if;
  return (
    with balances as materialized (select * from garments_erp.finished_balances(null)),
    returned_components as (
      select rb.id as return_id, bi.id as billing_item_id, bi.sellable_product_id,
        bp.item_size_list_id, sum(ri.returned_pieces)::bigint as pieces
      from garments_erp.return_bill rb
      join garments_erp.return_bill_item line on line.return_bill_id = rb.id
      join garments_erp.return_bill_item_piece_per_size ri on ri.return_bill_item_id = line.id
      join garments_erp.billing_item_piece_per_size bp on bp.id = ri.billing_item_piece_per_size_id
      join garments_erp.billing_item bi on bi.id = bp.billing_item_id
      where rb.verified_at is not null and bi.sellable_product_id is not null
      group by rb.id, bi.id, bi.sellable_product_id, bp.item_size_list_id
    ),
    returned_sets as (
      select events.sellable_product_id, sum(events.sets) as sets
      from (
        select r.return_id, r.billing_item_id, r.sellable_product_id,
          min(coalesce(c.pieces, 0) / u.share_weight) as sets
        from (select distinct return_id, billing_item_id, sellable_product_id from returned_components) r
        join garments_erp.billing_item_piece_per_size u on u.billing_item_id = r.billing_item_id and u.share_weight > 0
        left join returned_components c on c.return_id = r.return_id
          and c.billing_item_id = r.billing_item_id and c.item_size_list_id = u.item_size_list_id
        group by r.return_id, r.billing_item_id, r.sellable_product_id
      ) events
      group by events.sellable_product_id
    ),
    variations as (
      select v.id, v.name, v.sku,
        min(coalesce(b.available, 0) / u.share_weight) as capacity,
        min(coalesce(b.produced, 0) / u.share_weight) as produced_sets,
        jsonb_agg(jsonb_build_object('item_id', u.item_id::text, 'size_id', u.item_size_list_id::text,
          'share_weight', u.share_weight, 'available', coalesce(b.available, 0))
          order by u.item_id, u.item_size_list_id) as components
      from garments_erp.sellable_product v
      join garments_erp.sellable_unit u on u.sellable_product_id = v.id
      left join balances b on b.size_id = u.item_size_list_id
      where v.is_active and v.verified_by_employee_id is not null
        and (p_sku is null or v.sku = p_sku)
        and (p_variation_id is null or v.id = p_variation_id)
        and (p_item_id is null or exists (
          select 1 from garments_erp.sellable_unit c
          where c.sellable_product_id = v.id and c.item_id = p_item_id
        ))
      group by v.id, v.sku
    )
    select jsonb_build_object(
      'sizes', coalesce((
        select jsonb_agg(jsonb_build_object('item_id', b.item_id::text, 'size_id', b.size_id::text,
          'produced', b.produced, 'adjusted', b.adjusted, 'available', b.available)
          order by b.item_id, b.size_id)
        from (
          select * from balances b
          where (p_item_id is null or b.item_id = p_item_id)
            and ((p_sku is null and p_variation_id is null) or exists (
              select 1 from variations v join garments_erp.sellable_unit u on u.sellable_product_id = v.id
              where u.item_size_list_id = b.size_id
            ))
          order by b.item_id, b.size_id limit p_limit offset p_offset
        ) b
      ), '[]'::jsonb),
      'variations', coalesce((
        select jsonb_agg(jsonb_build_object('id', v.id::text, 'name', v.name,
          'sku', v.sku, 'capacity', v.capacity, 'produced_sets', v.produced_sets,
          'returned_sets', coalesce(r.sets, 0), 'components', v.components) order by v.id)
        from (select * from variations order by id limit p_limit offset p_offset) v
        left join returned_sets r on r.sellable_product_id = v.id
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.erp_verify_billing_return(
  p_request_id uuid, p_billing_id bigint, p_employee_id bigint, p_lines jsonb
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  result_id bigint;
  line_id bigint;
  line jsonb;
  original garments_erp.billing_item%rowtype;
  units numeric;
  mode text;
  previous garments_erp.billing_audit%rowtype;
  return_command jsonb := jsonb_build_object('action', 'return', 'billing_id', p_billing_id, 'lines', p_lines);
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Billing commands require read committed isolation';
  end if;
  if p_request_id is null or not exists (
    select 1 from garments_erp.employee where id = p_employee_id and is_active
  ) then raise exception 'Request ID and active employee required'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or p_lines = '[]'::jsonb then
    raise exception 'Return requires billed size components';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into previous from garments_erp.billing_audit where request_id = p_request_id;
  if found then
    if (previous.command, previous.employee_id) is distinct from (return_command, p_employee_id) then
      raise exception 'Request ID already used';
    end if;
    return (previous.after_state->>'return_id')::bigint;
  end if;
  perform 1 from garments_erp.billing b
  join garments_erp.billing_status_type st on st.id = b.billing_status_type_id
  where b.id = p_billing_id and st.type = 'dispatched' for update of b;
  if not found then raise exception 'Returns require a dispatched invoice'; end if;
  perform i.id from garments_erp.item i where i.id in (
    select s.item_id from garments_erp.item_size_list s
    join garments_erp.billing_item_piece_per_size bp on bp.item_size_list_id = s.id
    join garments_erp.billing_item l on l.id = bp.billing_item_id
    where l.billing_id = p_billing_id
  ) order by i.id for update;
  insert into garments_erp.return_bill (billing_id, date, verified_by_id, verified_at)
  values (p_billing_id, current_date, p_employee_id, now()) returning id into result_id;
  for line in select value from jsonb_array_elements(p_lines)
  loop
    mode := coalesce(line->>'mode', 'piece');
    units := (line->>'returned_units')::numeric;
    select bi.* into strict original
    from garments_erp.billing_item bi
    where bi.billing_id = p_billing_id and bi.id = coalesce(
      (line->>'billing_item_id')::bigint,
      (select billing_item_id from garments_erp.billing_item_piece_per_size
       where id = (line->>'billed_piece_id')::bigint));

    if mode = 'set' then
      if units is null or units <> trunc(units) or units < 1
         or original.billed_units is null or units > original.billed_units
         or original.sellable_product_id is null
         or not exists (select 1 from garments_erp.billing_item_piece_per_size where billing_item_id = original.id)
         or exists (select 1 from garments_erp.billing_item_piece_per_size
                    where billing_item_id = original.id and
                    (share_weight is null or share_weight <= 0 or billed_pieces <> share_weight::bigint * original.billed_units))
      then raise exception 'Set return requires whole sets and a valid frozen composition'; end if;
    elsif mode <> 'piece' or units is not null then
      raise exception 'Invalid return mode or quantity';
    end if;

    insert into garments_erp.return_bill_item
      (return_bill_id, billing_item_id, return_mode_type_id, return_reason_type_id,
       returned_units, unit_price, sellable_product_id)
    values (result_id, original.id, (select id from garments_erp.return_mode_type where type = mode),
      (line->>'reason_id')::bigint, units::integer, (line->>'unit_price')::numeric,
      case when mode = 'set' then original.sellable_product_id end)
    returning id into line_id;

    if mode = 'set' then
      insert into garments_erp.return_bill_item_piece_per_size
        (return_bill_item_id, billing_item_piece_per_size_id, item_size_list_id, share_weight, returned_pieces)
      select line_id, id, item_size_list_id, share_weight, (share_weight * units)::integer
      from garments_erp.billing_item_piece_per_size where billing_item_id = original.id;
    else
      insert into garments_erp.return_bill_item_piece_per_size
        (return_bill_item_id, billing_item_piece_per_size_id, item_size_list_id, returned_pieces, returned_price_per_piece)
      select line_id, bp.id, bp.item_size_list_id,
        case when part.pieces = trunc(part.pieces) then part.pieces::integer end, part.price
      from jsonb_to_recordset(coalesce(line->'pieces_by_size', jsonb_build_array(line)))
        as part(billed_piece_id bigint, pieces numeric, price numeric)
      left join garments_erp.billing_item_piece_per_size bp
        on bp.id = part.billed_piece_id and bp.billing_item_id = original.id;
      if not found then raise exception 'Piece return requires billed size components'; end if;
    end if;
  end loop;

  if exists (
    select 1
    from garments_erp.return_bill_item_piece_per_size part
    join garments_erp.return_bill_item ri on ri.id = part.return_bill_item_id
    join garments_erp.return_bill rb on rb.id = ri.return_bill_id
    join garments_erp.billing_item_piece_per_size bp on bp.id = part.billing_item_piece_per_size_id
    where rb.billing_id = p_billing_id and rb.verified_at is not null
    group by bp.id, bp.billed_pieces
    having sum(part.returned_pieces) > bp.billed_pieces
  ) then raise exception 'Cumulative return exceeds dispatched pieces'; end if;
  insert into garments_erp.billing_audit (request_id, billing_id, employee_id, command, after_state)
  values (p_request_id, p_billing_id, p_employee_id, return_command, jsonb_build_object('return_id', result_id));
  return result_id;
end;
$$;

commit;
