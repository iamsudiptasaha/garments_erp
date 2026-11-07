begin;
set local lock_timeout = '10s';

-- Legacy records do not identify whether stock was held, sold, or dispatched.
-- Abort the release rather than reinterpret an existing invoice.
lock table garments_erp.billing, garments_erp.carton_item,
  garments_erp.transport_item, garments_erp.return_bill in access exclusive mode;
do $$
begin
  if exists (select 1 from garments_erp.billing)
     or exists (select 1 from garments_erp.return_bill) then
    raise exception 'Existing invoices or returns require explicit lifecycle reconciliation';
  end if;
end;
$$;

create table garments_erp.billing_status_type (
  id bigint generated always as identity primary key,
  type text not null unique
);
insert into garments_erp.billing_status_type (type)
values ('draft'), ('cancelled'), ('finalized'), ('dispatched');

create table garments_erp.sale_mode_type (
  id bigint generated always as identity primary key,
  type text not null unique
);
insert into garments_erp.sale_mode_type (type) values ('standard'), ('exception');

alter table garments_erp.billing
  add column billing_status_type_id bigint not null references garments_erp.billing_status_type,
  add column sale_mode_type_id bigint not null references garments_erp.sale_mode_type,
  add column verified_by bigint references garments_erp.employee,
  add column finalized_at timestamptz,
  add column dispatched_at timestamptz;
alter table garments_erp.billing_item
  add column price_version_id bigint references garments_erp.item_in_store_price,
  add column set_quantity integer check (set_quantity > 0),
  add constraint billing_item_sale_shape check (
    (item_in_store_variation_id is null and price_version_id is null
      and set_quantity is null and billed_price is null)
    or (item_in_store_variation_id is not null and price_version_id is not null
      and set_quantity is not null and billed_price is not null and billed_price >= 0)
  );
alter table garments_erp.billing_item_piece_per_size
  add column price_per_piece numeric check (price_per_piece >= 0 and price_per_piece < 'Infinity'::numeric),
  alter column share_weight set not null,
  add check (share_weight between 1 and 2147483647 and trunc(share_weight) = share_weight),
  add check (billed_pieces between 1 and 2147483647 and trunc(billed_pieces) = billed_pieces);
alter table garments_erp.return_bill
  add column billing_id bigint not null references garments_erp.billing,
  add column verified_by_id bigint references garments_erp.employee,
  add column verified_at timestamptz,
  add check ((verified_by_id is null) = (verified_at is null));
alter table garments_erp.return_bill_item
  add column returned_price_per_piece numeric not null
    check (returned_price_per_piece >= 0 and returned_price_per_piece < 'Infinity'::numeric),
  add check (returned_pieces between 1 and 2147483647 and trunc(returned_pieces) = returned_pieces);

create table garments_erp.carton (
  id bigint generated always as identity primary key,
  packing_list_id bigint not null references garments_erp.packing_list,
  carton_number text not null check (btrim(carton_number) <> ''),
  carton_identifier_barcode text unique,
  unique (packing_list_id, carton_number)
);
alter table garments_erp.carton_item
  drop column packing_list_id,
  drop column carton_number,
  drop column carton_identifier_barcode,
  add column carton_id bigint not null references garments_erp.carton,
  add column packed_units integer check (packed_units > 0),
  add unique (carton_id, billing_item_id);

create table garments_erp.carton_item_piece_per_size (
  id bigint generated always as identity primary key,
  carton_item_id bigint not null references garments_erp.carton_item on delete cascade,
  billing_item_piece_per_size_id bigint not null references garments_erp.billing_item_piece_per_size,
  packed_pieces integer not null check (packed_pieces > 0),
  unique (carton_item_id, billing_item_piece_per_size_id)
);
alter table garments_erp.transport_item
  drop column carton_item_id,
  add column carton_id bigint not null unique references garments_erp.carton,
  drop column transporter_id,
  drop column appointment_date,
  drop column asn_confirmed,
  drop column asn_master,
  drop column e_way_bill_number,
  drop column warehouse_in_date,
  drop column docket_number;

create table garments_erp.billing_audit (
  request_id uuid not null,
  billing_id bigint not null references garments_erp.billing,
  employee_id bigint not null references garments_erp.employee,
  recorded_at timestamptz not null default now(),
  command jsonb not null,
  before_state jsonb,
  after_state jsonb not null,
  primary key (request_id, billing_id)
);

alter table garments_erp.billing_status_type enable row level security;
alter table garments_erp.sale_mode_type enable row level security;
alter table garments_erp.carton enable row level security;
alter table garments_erp.carton_item_piece_per_size enable row level security;
alter table garments_erp.billing_audit enable row level security;

create index on garments_erp.billing_item (po_item_id);
create index on garments_erp.billing_item_piece_per_size (item_size_list_id);
create index on garments_erp.return_bill_item (billing_item_piece_per_size_id);
create index on garments_erp.carton_item (billing_item_id);
create index on garments_erp.billing_audit (billing_id);

create view garments_access.billed_stock as
select p.item_size_list_id,
       coalesce(sum(p.billed_pieces) filter (where status.type in ('finalized', 'dispatched')), 0)::bigint as sold,
       coalesce(sum(p.billed_pieces) filter (where status.type = 'draft'), 0)::bigint as held
from garments_erp.billing_item_piece_per_size p
join garments_erp.billing_item l on l.id = p.billing_item_id
join garments_erp.billing b on b.id = l.billing_id
join garments_erp.billing_status_type status on status.id = b.billing_status_type_id
group by p.item_size_list_id;

create or replace function garments_access.finished_balances(p_item_id bigint)
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
  left join garments_access.billed_stock b on b.item_size_list_id = s.id
  left join (
    select bp.item_size_list_id, sum(ri.returned_pieces)::bigint as pieces
    from garments_erp.return_bill_item ri
    join garments_erp.return_bill rb on rb.id = ri.return_bill_id
    join garments_erp.billing_item_piece_per_size bp on bp.id = ri.billing_item_piece_per_size_id
    where rb.verified_at is not null
    group by bp.item_size_list_id
  ) r on r.item_size_list_id = s.id
  where p_item_id is null or s.item_id = p_item_id;
$$;

create function public.erp_billing_stock(p_item_id bigint)
returns table (item_id bigint, item_size_list_id bigint, on_hand bigint, held bigint, available bigint)
language sql stable security definer set search_path = '' as $$
  select s.item_id, s.size_id, s.available + coalesce(b.held, 0),
    coalesce(b.held, 0), s.available
  from garments_access.finished_balances(p_item_id) s
  left join garments_access.billed_stock b on b.item_size_list_id = s.size_id;
$$;
revoke all on function public.erp_billing_stock(bigint) from public, anon, authenticated;
grant execute on function public.erp_billing_stock(bigint) to service_role;

create function public.erp_billing_po_allowance(p_po_item_id bigint)
returns table (item_size_list_id bigint, remaining numeric)
language sql stable security definer set search_path = '' as $$
  select ordered.item_size_list_id, ordered.pieces_ordered - coalesce(used.pieces, 0)
  from garments_erp.po_item_piece_per_size ordered
  left join (
    select p.item_size_list_id, sum(p.billed_pieces) as pieces
    from garments_erp.billing_item_piece_per_size p
    join garments_erp.billing_item l on l.id = p.billing_item_id
    join garments_erp.billing b on b.id = l.billing_id
    join garments_erp.billing_status_type status on status.id = b.billing_status_type_id
    where l.po_item_id = p_po_item_id and status.type in ('draft', 'finalized', 'dispatched')
    group by p.item_size_list_id
  ) used using (item_size_list_id)
  where ordered.po_item_id = p_po_item_id;
$$;
revoke all on function public.erp_billing_po_allowance(bigint) from public, anon, authenticated;
grant execute on function public.erp_billing_po_allowance(bigint) to service_role;

create function garments_access.billing_snapshot(p_id bigint)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('invoice', to_jsonb(b), 'lines', coalesce((
    select jsonb_agg(to_jsonb(l) || jsonb_build_object('pieces', (
      select jsonb_agg(to_jsonb(p) order by p.id)
      from garments_erp.billing_item_piece_per_size p where p.billing_item_id = l.id
    )) order by l.id)
    from garments_erp.billing_item l where l.billing_id = b.id
  ), '[]'::jsonb))
  from garments_erp.billing b where b.id = p_id;
$$;

-- Billing commands serialize with stock adjustments on manufactured items and
-- with other allocations against the same PO item.
create function public.erp_billing_command(p_request_id uuid, p_employee_id bigint, p_command jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  invoice_id bigint := (p_command->>'billing_id')::bigint;
  line_id bigint := (p_command->>'line_id')::bigint;
  po_id bigint := (p_command->>'po_item_id')::bigint;
  variation_id bigint := (p_command->>'variation_id')::bigint;
  version_id bigint := (p_command->>'price_version_id')::bigint;
  sets integer := (p_command->>'sets')::integer;
  action text := p_command->>'action';
  invoice_status text;
  invoice_mode text;
  previous jsonb;
  components jsonb;
  set_price numeric;
  prior garments_erp.billing_audit%rowtype;
  old_line garments_erp.billing_item%rowtype;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Billing commands require read committed isolation';
  end if;
  if p_request_id is null or not exists (
    select 1 from garments_erp.employee where id = p_employee_id and is_active
  ) then raise exception 'Request ID and active employee required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into prior from garments_erp.billing_audit where request_id = p_request_id;
  if found then
    if (prior.command, prior.employee_id) is distinct from (p_command, p_employee_id) then
      raise exception 'Request ID already used';
    end if;
    return prior.billing_id;
  end if;

  if action = 'create' then
    insert into garments_erp.billing (invoice_number, invoice_date, billing_status_type_id, sale_mode_type_id)
    values (p_command->>'invoice_number', (p_command->>'invoice_date')::date,
      (select id from garments_erp.billing_status_type where type = 'draft'),
      (select id from garments_erp.sale_mode_type where type = p_command->>'mode'))
    returning id into invoice_id;
  else
    select st.type, mode.type into strict invoice_status, invoice_mode
    from garments_erp.billing b
    join garments_erp.billing_status_type st on st.id = b.billing_status_type_id
    join garments_erp.sale_mode_type mode on mode.id = b.sale_mode_type_id
    where b.id = invoice_id for update of b;
    previous := garments_access.billing_snapshot(invoice_id);
    if invoice_status not in ('draft', 'finalized') then raise exception 'Invoice is immutable'; end if;

    if action in ('save_line', 'remove_line') then
      if line_id is not null then
        select * into strict old_line from garments_erp.billing_item
        where id = line_id and billing_id = invoice_id;
        if exists (
          select 1 from garments_erp.carton_item ci
          join garments_erp.transport_item ti on ti.carton_id = ci.carton_id
          join garments_erp.transport t on t.id = ti.transport_id
          where ci.billing_item_id = line_id and t.dispatched_at is not null
        ) then raise exception 'A dispatched carton freezes its billed line'; end if;
      end if;
      if action = 'save_line' and invoice_mode = 'standard' then
        if sets is null or sets < 1 then raise exception 'Positive set quantity required'; end if;
        select pr.price into strict set_price
        from garments_erp.item_in_store_price pr
        join garments_erp.item_in_store_variation v on v.id = pr.item_in_store_variation_id
        join garments_erp.item_in_store product on product.id = v.item_in_store_id
        where pr.id = version_id and v.id = variation_id
          and v.is_active and product.is_active
          and v.verified_at is not null and product.verified_by_employee_id is not null
          and pr.price >= 0 and pr.price < 'Infinity'::numeric
        for share of pr, v, product;
        select jsonb_agg(jsonb_build_object(
          'size_id', item_size_list_id, 'pieces', share_weight::bigint * sets,
          'weight', share_weight
        )) into components
        from garments_erp.sellable_unit where item_in_store_variation_id = variation_id;
      elsif action = 'save_line' then
        if variation_id is not null or version_id is not null or sets is not null then
          raise exception 'Exception billing takes only physical pieces and prices';
        end if;
        components := p_command->'pieces';
      else
        components := '[]'::jsonb;
      end if;

      if action = 'save_line' and (
        jsonb_typeof(components) is distinct from 'array' or components = '[]'::jsonb
      ) then raise exception 'At least one size component required'; end if;

      if action = 'save_line' and old_line.item_in_store_variation_id is distinct from variation_id
         and exists (select 1 from garments_erp.carton_item where billing_item_id = line_id) then
        raise exception 'Remove carton allocations before changing the packed variation';
      end if;
      perform i.id from garments_erp.item i
      where i.id in (
        select s.item_id from garments_erp.item_size_list s
        where s.id in (
          select p.item_size_list_id from garments_erp.billing_item_piece_per_size p
          where p.billing_item_id = line_id
          union
          select (part->>'size_id')::bigint from jsonb_array_elements(components) part
        )
      ) order by i.id for update;
      perform id from garments_erp.po_item
      where id in (po_id, old_line.po_item_id) order by id for update;

      if action = 'remove_line' then
        if line_id is null then raise exception 'Billing line required'; end if;
        if invoice_status = 'finalized' and not exists (
          select 1 from garments_erp.billing_item where billing_id = invoice_id and id <> line_id
        ) then raise exception 'A finalized invoice requires at least one line'; end if;
        delete from garments_erp.billing_item_piece_per_size where billing_item_id = line_id;
        delete from garments_erp.billing_item where id = line_id;
      else
        if line_id is null then
          insert into garments_erp.billing_item (
            billing_id, po_item_id, item_in_store_variation_id, price_version_id, set_quantity, billed_price
          ) values (invoice_id, po_id, variation_id, version_id, sets, set_price) returning id into line_id;
        else
          update garments_erp.billing_item
          set po_item_id = po_id, item_in_store_variation_id = variation_id,
              price_version_id = version_id, set_quantity = sets, billed_price = set_price
          where id = line_id;
        end if;
        if exists (
          select 1 from jsonb_to_recordset(components) as c(size_id bigint, pieces numeric, price numeric)
          where c.size_id is null or c.pieces is null or c.pieces <> trunc(c.pieces)
            or (invoice_mode = 'exception' and c.price is null)
        ) then raise exception 'Each component requires a size, whole pieces and an exception price'; end if;
        delete from garments_erp.billing_item_piece_per_size p where p.billing_item_id = line_id
          and not exists (select 1 from jsonb_array_elements(components) part where (part->>'size_id')::bigint = p.item_size_list_id);
        insert into garments_erp.billing_item_piece_per_size
          (billing_item_id, item_size_list_id, share_weight, billed_pieces, price_per_piece)
        select line_id, size_id, case when invoice_mode = 'standard' then weight else 1 end, pieces,
               case when invoice_mode = 'exception' then price end
        from jsonb_to_recordset(components) as c(size_id bigint, weight numeric, pieces numeric, price numeric)
        on conflict (billing_item_id, item_size_list_id) do update
        set share_weight = excluded.share_weight, billed_pieces = excluded.billed_pieces,
            price_per_piece = excluded.price_per_piece;

        if exists (
          select 1 from garments_erp.billing_item_piece_per_size p
          join garments_access.finished_balances(null) s on s.size_id = p.item_size_list_id
          left join public.erp_billing_po_allowance(po_id) po on po.item_size_list_id = p.item_size_list_id
          where p.billing_item_id = line_id and (s.available < 0 or po.remaining is null or po.remaining < 0)
        ) then raise exception 'Insufficient physical stock or PO allowance'; end if;
      end if;
      perform garments_access.check_billing_packing(invoice_id, false);
    elsif action = 'finalize' and invoice_status = 'draft' then
      if not exists (select 1 from garments_erp.billing_item where billing_id = invoice_id) then
        raise exception 'Cannot finalize an empty invoice';
      end if;
      update garments_erp.billing set billing_status_type_id = (
        select id from garments_erp.billing_status_type where type = 'finalized'
      ), verified_by = p_employee_id, finalized_at = now() where id = invoice_id;
    elsif action = 'cancel' and invoice_status = 'draft' then
      update garments_erp.billing set billing_status_type_id = (
        select id from garments_erp.billing_status_type where type = 'cancelled'
      ) where id = invoice_id;
    else
      raise exception 'Invalid billing command or status transition';
    end if;
  end if;
  insert into garments_erp.billing_audit (request_id, billing_id, employee_id, command, before_state, after_state)
  values (p_request_id, invoice_id, p_employee_id, p_command, previous, garments_access.billing_snapshot(invoice_id));
  return invoice_id;
end;
$$;
revoke all on function public.erp_billing_command(uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.erp_billing_command(uuid, bigint, jsonb) to service_role;

create function garments_access.check_billing_packing(p_id bigint, p_complete boolean)
returns void language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1
    from garments_erp.billing_item l
    left join garments_erp.carton_item ci on ci.billing_item_id = l.id
    where l.billing_id = p_id and l.set_quantity is not null
    group by l.id
    having coalesce(sum(ci.packed_units), 0) > l.set_quantity
      or (p_complete and coalesce(sum(ci.packed_units), 0) <> l.set_quantity)
  ) or exists (
    select 1
    from garments_erp.billing_item_piece_per_size bp
    join garments_erp.billing_item l on l.id = bp.billing_item_id
    left join garments_erp.carton_item_piece_per_size cp on cp.billing_item_piece_per_size_id = bp.id
    where l.billing_id = p_id and l.set_quantity is null
    group by bp.id
    having coalesce(sum(cp.packed_pieces), 0) > bp.billed_pieces
      or (p_complete and coalesce(sum(cp.packed_pieces), 0) <> bp.billed_pieces)
  ) then raise exception 'Carton allocations exceed billed quantities or packing is incomplete'; end if;
  if p_complete and exists (
    select 1 from garments_erp.carton c
    join garments_erp.packing_list pl on pl.id = c.packing_list_id
    where pl.billing_id = p_id and not exists (
      select 1 from garments_erp.carton_item ci where ci.carton_id = c.id
    )
  ) then raise exception 'Empty cartons must be removed before dispatch'; end if;
end;
$$;

-- A packing list and carton numbers are stable. Save replaces the contents
-- of one unshipped carton, so retries produce the same allocations.
create function public.erp_pack_billing_carton(
  p_billing_id bigint, p_list_number text, p_carton_number text, p_allocations jsonb
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  list_id bigint;
  packed_carton_id bigint;
  allocation_id bigint;
  allocation jsonb;
  line garments_erp.billing_item%rowtype;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Packing requires read committed isolation';
  end if;
  perform 1 from garments_erp.billing b
  join garments_erp.billing_status_type st on st.id = b.billing_status_type_id
  where b.id = p_billing_id and st.type = 'finalized' for update of b;
  if not found then raise exception 'Packing requires a finalized invoice'; end if;
  if jsonb_typeof(p_allocations) is distinct from 'array' then raise exception 'Allocations must be an array'; end if;

  insert into garments_erp.packing_list (billing_id, packing_list_number)
  values (p_billing_id, p_list_number) on conflict (billing_id) do nothing;
  select id into strict list_id from garments_erp.packing_list
  where billing_id = p_billing_id and packing_list_number = p_list_number;
  insert into garments_erp.carton (packing_list_id, carton_number)
  values (list_id, p_carton_number) on conflict (packing_list_id, carton_number) do nothing;
  select id into strict packed_carton_id from garments_erp.carton
  where packing_list_id = list_id and carton_number = p_carton_number;
  if exists (
    select 1 from garments_erp.transport_item ti
    join garments_erp.transport t on t.id = ti.transport_id
    where ti.carton_id = packed_carton_id and t.dispatched_at is not null
  ) then raise exception 'Dispatched carton is immutable'; end if;

  delete from garments_erp.carton_item where carton_id = packed_carton_id;
  if p_allocations = '[]'::jsonb then
    delete from garments_erp.carton where id = packed_carton_id;
    return null;
  end if;

  for allocation in select value from jsonb_array_elements(p_allocations) loop
    select * into strict line from garments_erp.billing_item
    where id = (allocation->>'line_id')::bigint and billing_id = p_billing_id;
    if line.set_quantity is not null then
      if (allocation->>'sets')::integer is null or allocation ? 'pieces' then
        raise exception 'Standard packing requires whole sets';
      end if;
      insert into garments_erp.carton_item (carton_id, billing_item_id, packed_units)
      values (packed_carton_id, line.id, (allocation->>'sets')::integer);
    else
      if allocation ? 'sets' or jsonb_typeof(allocation->'pieces') is distinct from 'array'
         or allocation->'pieces' = '[]'::jsonb then raise exception 'Exception packing requires physical pieces'; end if;
      if exists (
        select 1 from jsonb_to_recordset(allocation->'pieces') as part(pieces numeric)
        where pieces <> trunc(pieces)
      ) then raise exception 'Packing requires whole physical pieces'; end if;
      insert into garments_erp.carton_item (carton_id, billing_item_id)
      values (packed_carton_id, line.id) returning id into allocation_id;
      insert into garments_erp.carton_item_piece_per_size
        (carton_item_id, billing_item_piece_per_size_id, packed_pieces)
      select allocation_id, (
        select bp.id from garments_erp.billing_item_piece_per_size bp
        where bp.id = part.billed_piece_id and bp.billing_item_id = line.id
      ), part.pieces
      from jsonb_to_recordset(allocation->'pieces') as part(billed_piece_id bigint, pieces integer);
    end if;
  end loop;
  perform garments_access.check_billing_packing(p_billing_id, false);
  return packed_carton_id;
end;
$$;
revoke all on function public.erp_pack_billing_carton(bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.erp_pack_billing_carton(bigint, text, text, jsonb) to service_role;

create function garments_access.guard_transport_cartons()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform id from garments_erp.transport
  where id in (
    case when tg_op <> 'INSERT' then old.transport_id end,
    case when tg_op <> 'DELETE' then new.transport_id end
  ) order by id for update;
  if exists (
    select 1 from garments_erp.transport
    where dispatched_at is not null and id in (
      case when tg_op <> 'INSERT' then old.transport_id end,
      case when tg_op <> 'DELETE' then new.transport_id end
    )
  ) then raise exception 'Dispatched transport assignments are immutable'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_transport_cartons before insert or update or delete on garments_erp.transport_item
for each row execute function garments_access.guard_transport_cartons();

create function public.erp_dispatch_transport(p_transport_id bigint, p_employee_id bigint, p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  invoice record;
  command jsonb := jsonb_build_object('action', 'dispatch', 'transport_id', p_transport_id);
  prior garments_erp.billing_audit%rowtype;
  dispatched_status bigint;
  old_state jsonb;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Billing commands require read committed isolation';
  end if;
  if p_request_id is null or not exists (
    select 1 from garments_erp.employee where id = p_employee_id and is_active
  ) then raise exception 'Request ID and active employee required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into prior from garments_erp.billing_audit where request_id = p_request_id;
  if found then
    if (prior.command, prior.employee_id) is distinct from (command, p_employee_id) then
      raise exception 'Request ID already used';
    end if;
    return;
  end if;
  perform 1 from garments_erp.transport
  where id = p_transport_id and dispatched_at is null for update;
  if not found then raise exception 'Transport is missing or already dispatched'; end if;
  if not exists (select 1 from garments_erp.transport_item where transport_id = p_transport_id) then
    raise exception 'Transport requires cartons';
  end if;

  select id into strict dispatched_status from garments_erp.billing_status_type where type = 'dispatched';
  perform b.id from garments_erp.billing b
  where b.id in (
    select pl.billing_id from garments_erp.transport_item ti
    join garments_erp.carton c on c.id = ti.carton_id
    join garments_erp.packing_list pl on pl.id = c.packing_list_id
    where ti.transport_id = p_transport_id
  ) order by b.id for update;

  update garments_erp.transport set dispatched_at = now(), transport_status_type_id = (
    select id from garments_erp.transport_status_type where type = 'dispatched'
  ) where id = p_transport_id;

  for invoice in
    select distinct b.id, st.type
    from garments_erp.transport_item ti
    join garments_erp.carton c on c.id = ti.carton_id
    join garments_erp.packing_list pl on pl.id = c.packing_list_id
    join garments_erp.billing b on b.id = pl.billing_id
    join garments_erp.billing_status_type st on st.id = b.billing_status_type_id
    where ti.transport_id = p_transport_id order by b.id
  loop
    if invoice.type <> 'finalized' then raise exception 'Only finalized invoices can be dispatched'; end if;
    perform garments_access.check_billing_packing(invoice.id, true);
    old_state := garments_access.billing_snapshot(invoice.id);
    if not exists (
      select 1 from garments_erp.carton c
      join garments_erp.packing_list pl on pl.id = c.packing_list_id
      left join garments_erp.transport_item ti on ti.carton_id = c.id
      left join garments_erp.transport t on t.id = ti.transport_id
      where pl.billing_id = invoice.id and t.dispatched_at is null
    ) then
      update garments_erp.billing set billing_status_type_id = dispatched_status, dispatched_at = now()
      where id = invoice.id;
    end if;
    insert into garments_erp.billing_audit
      (request_id, billing_id, employee_id, command, before_state, after_state)
    values (p_request_id, invoice.id, p_employee_id, command, old_state, garments_access.billing_snapshot(invoice.id));
  end loop;
end;
$$;
revoke all on function public.erp_dispatch_transport(bigint, bigint, uuid) from public, anon, authenticated;
grant execute on function public.erp_dispatch_transport(bigint, bigint, uuid) to service_role;

create function public.erp_verify_billing_return(
  p_request_id uuid, p_billing_id bigint, p_employee_id bigint, p_lines jsonb
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  result_id bigint;
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
  insert into garments_erp.return_bill_item (
    return_bill_id, billing_item_piece_per_size_id, returned_pieces,
    returned_price_per_piece, return_reason_type_id
  )
  select result_id, (
    select bp.id from garments_erp.billing_item_piece_per_size bp
    join garments_erp.billing_item l on l.id = bp.billing_item_id
    where bp.id = part.billed_piece_id and l.billing_id = p_billing_id
  ), part.pieces, part.price, part.reason_id
  from jsonb_to_recordset(p_lines) as part(billed_piece_id bigint, pieces numeric, price numeric, reason_id bigint);
  if exists (
    select 1 from garments_erp.return_bill_item ri
    join garments_erp.billing_item_piece_per_size bp on bp.id = ri.billing_item_piece_per_size_id
    where ri.return_bill_id = result_id and bp.billed_pieces < (
      select sum(other.returned_pieces)
      from garments_erp.return_bill_item other
      join garments_erp.return_bill rb on rb.id = other.return_bill_id
      where other.billing_item_piece_per_size_id = bp.id and rb.verified_at is not null
    )
  ) then raise exception 'Cumulative return exceeds dispatched pieces'; end if;
  insert into garments_erp.billing_audit (request_id, billing_id, employee_id, command, after_state)
  values (p_request_id, p_billing_id, p_employee_id, return_command, jsonb_build_object('return_id', result_id));
  return result_id;
end;
$$;
revoke all on function public.erp_verify_billing_return(uuid, bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.erp_verify_billing_return(uuid, bigint, bigint, jsonb) to service_role;

create function garments_access.guard_billed_price()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from garments_erp.billing_item where price_version_id = old.id)
     or exists (
       select 1 from garments_erp.billing_audit a
       cross join lateral jsonb_array_elements(a.after_state->'lines') line
       where (line->>'price_version_id')::bigint = old.id
     ) then raise exception 'A billed price version is immutable'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_billed_price before update or delete on garments_erp.item_in_store_price
for each row execute function garments_access.guard_billed_price();

create function garments_access.guard_billed_po_allowance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  used numeric;
begin
  perform 1 from garments_erp.po_item where id = old.po_item_id for update;
  select coalesce(sum(bp.billed_pieces), 0) into used
  from garments_erp.billing_item_piece_per_size bp
  join garments_erp.billing_item l on l.id = bp.billing_item_id
  join garments_erp.billing b on b.id = l.billing_id
  join garments_erp.billing_status_type st on st.id = b.billing_status_type_id
  where l.po_item_id = old.po_item_id and bp.item_size_list_id = old.item_size_list_id
    and st.type in ('draft', 'finalized', 'dispatched');
  if used > 0 and (tg_op = 'DELETE' or new.pieces_ordered < used
    or (new.po_item_id, new.item_size_list_id) is distinct from (old.po_item_id, old.item_size_list_id)) then
    raise exception 'PO allowance already allocated';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_billed_po_allowance before update or delete on garments_erp.po_item_piece_per_size
for each row execute function garments_access.guard_billed_po_allowance();

create function garments_access.guard_transport_header()
returns trigger language plpgsql set search_path = '' as $$
declare
  status text;
begin
  select type into strict status from garments_erp.transport_status_type
  where id = new.transport_status_type_id;
  if (tg_op = 'INSERT' and (status <> 'draft' or new.dispatched_at is not null))
    or (status = 'dispatched') <> (new.dispatched_at is not null)
    or (tg_op = 'UPDATE' and old.dispatched_at is not null
      and (new.dispatched_at, new.transport_status_type_id)
        is distinct from (old.dispatched_at, old.transport_status_type_id))
  then raise exception 'Invalid transport dispatch state'; end if;
  return new;
end;
$$;
create trigger guard_transport_header before insert or update on garments_erp.transport
for each row execute function garments_access.guard_transport_header();

-- The service exposes guarded commands. Table writes must not bypass them.
revoke insert, update, delete, truncate on
  garments_erp.billing, garments_erp.billing_item, garments_erp.billing_item_piece_per_size,
  garments_erp.return_bill, garments_erp.return_bill_item, garments_erp.packing_list,
  garments_erp.carton, garments_erp.carton_item, garments_erp.carton_item_piece_per_size,
  garments_erp.billing_audit, garments_erp.billing_status_type, garments_erp.sale_mode_type
from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate on garments_erp.transport_item from public, anon, authenticated;
revoke truncate on garments_erp.transport, garments_erp.transport_item from service_role;
revoke insert, update on garments_erp.transport from service_role;
grant insert (appointment_date, transporter_id, asn_confirmed, asn_master, e_way_bill_number,
  warehouse_in_date, transport_status_type_id) on garments_erp.transport to service_role;
grant update (appointment_date, transporter_id, asn_confirmed, asn_master, e_way_bill_number,
  warehouse_in_date) on garments_erp.transport to service_role;
grant select on garments_erp.billing_status_type, garments_erp.sale_mode_type, garments_erp.carton,
  garments_erp.carton_item_piece_per_size, garments_erp.billing_audit to service_role;
revoke all on function garments_access.billing_snapshot(bigint),
  garments_access.check_billing_packing(bigint, boolean),
  garments_access.guard_transport_cartons(), garments_access.guard_billed_price(),
  garments_access.guard_billed_po_allowance(), garments_access.guard_transport_header() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
