begin;

alter table garments_erp.billing add column formal_po_id bigint references garments_erp.buyer_po (id);

-- Only historical invoices with a single identifiable source can be backfilled.
with sources as (
  select l.billing_id, min(p.buyer_po_id) as po_id
  from garments_erp.billing_item l
  join garments_erp.po_item p on p.id = l.po_item_id
  group by l.billing_id
  having count(distinct p.buyer_po_id) = 1
)
update garments_erp.billing b set formal_po_id = sources.po_id
from sources where b.id = sources.billing_id and b.adhoc_po_id is null;

alter table garments_erp.billing
  add constraint billing_one_purchase_order check (num_nonnulls(formal_po_id, adhoc_po_id) = 1),
  add constraint billing_gst_range check (gst_percentage between 0 and 100),
  alter column invoice_number drop not null,
  drop constraint billing_invoice_number_key;

-- Status IDs are obtained from the lookup rather than assuming seed identities.
do $$
declare
  issued_status_ids text;
begin
  select string_agg(id::text, ',' order by id) into issued_status_ids
  from garments_erp.billing_status_type where type in ('finalized', 'dispatched');
  if (select count(*) from garments_erp.billing_status_type where type in ('finalized', 'dispatched')) <> 2 then
    raise exception 'Billing issue statuses are missing';
  end if;
  execute format(
    'alter table garments_erp.billing add constraint billing_issued_number_and_gst
     check (billing_status_type_id not in (%s) or
            (invoice_number is not null and btrim(invoice_number) <> '''' and gst_percentage is not null))',
    issued_status_ids
  );
  execute format(
    'create unique index billing_issued_invoice_number on garments_erp.billing (btrim(invoice_number))
     where billing_status_type_id in (%s)', issued_status_ids
  );
end $$;

create index billing_formal_po_idx on garments_erp.billing (formal_po_id) where formal_po_id is not null;

create function garments_erp.check_billing_line_purchase_order()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from garments_erp.billing b
    join garments_erp.po_item p on p.id = new.po_item_id
    where b.id = new.billing_id and p.buyer_po_id = coalesce(b.formal_po_id, b.adhoc_po_id)
  ) then raise exception 'Billing line must belong to the invoice PO'; end if;
  return new;
end $$;

revoke all on function garments_erp.check_billing_line_purchase_order() from public, anon, authenticated;
create trigger check_billing_line_purchase_order
before insert or update of billing_id, po_item_id on garments_erp.billing_item
for each row execute function garments_erp.check_billing_line_purchase_order();

create or replace function public.erp_billing_command(p_request_id uuid, p_employee_id bigint, p_command jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  invoice_id bigint := (p_command->>'billing_id')::bigint;
  line_id bigint := (p_command->>'line_id')::bigint;
  po_id bigint := (p_command->>'po_item_id')::bigint;
  variation_id bigint := (p_command->>'variation_id')::bigint;
  version_id bigint := (p_command->>'price_version_id')::bigint;
  sets integer := (p_command->>'sets')::integer;
  action text := p_command->>'action';
  buyer_id bigint := (p_command->>'buyer_list_id')::bigint;
  shadow_id bigint;
  formal_id bigint := (p_command->>'formal_po_id')::bigint;
  entered_number text := nullif(btrim(p_command->>'invoice_number'), '');
  entered_gst numeric := (p_command->>'gst_percentage')::numeric;
  po_product_type_id bigint := (p_command->>'product_type_list_id')::bigint;
  hsn_by_size jsonb := p_command->'hsn_by_size';
  po_line garments_erp.po_item%rowtype;
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
    if coalesce((p_command->>'adhoc')::boolean, false) then
      if formal_id is not null or buyer_id is null then raise exception 'Ad-hoc billing requires only a buyer'; end if;
      insert into garments_erp.buyer_po (po_number, buyer_list_id, po_issue_date, po_source_type_id)
      values ('ADHOC-' || p_request_id, buyer_id, (p_command->>'invoice_date')::date, garments_erp.adhoc_po_source_id())
      returning id into shadow_id;
    else
      select h.buyer_list_id into buyer_id
      from garments_erp.buyer_po h
      where h.id = formal_id and h.po_source_type_id = garments_erp.formal_po_source_id()
        and h.cancelled_at is null
      for share;
      if not found then raise exception 'Select an active formal PO'; end if;
      if not exists (
        select 1 from garments_erp.po_item p
        join garments_erp.sale_mode_type m on m.id = p.sale_mode_type_id
        where p.buyer_po_id = formal_id and m.type = p_command->>'mode'
      ) then raise exception 'The selected PO has no lines for this sale mode'; end if;
    end if;
    insert into garments_erp.billing (invoice_number, invoice_date, billing_status_type_id, sale_mode_type_id,
                                      buyer_list_id, adhoc_po_id, formal_po_id, gst_percentage)
    values (entered_number, (p_command->>'invoice_date')::date,
      (select id from garments_erp.billing_status_type where type = 'draft'),
      (select id from garments_erp.sale_mode_type where type = p_command->>'mode'), buyer_id, shadow_id, formal_id, entered_gst)
    returning id into invoice_id;
  else
    select st.type, mode.type, b.buyer_list_id, b.adhoc_po_id, b.formal_po_id
      into strict invoice_status, invoice_mode, buyer_id, shadow_id, formal_id
    from garments_erp.billing b
    join garments_erp.billing_status_type st on st.id = b.billing_status_type_id
    join garments_erp.sale_mode_type mode on mode.id = b.sale_mode_type_id
    where b.id = invoice_id for update of b;
    previous := garments_erp.billing_snapshot(invoice_id);
    if invoice_status not in ('draft', 'finalized') then raise exception 'Invoice is immutable'; end if;

    if action = 'save_header' and invoice_status = 'draft' then
      update garments_erp.billing b set
        invoice_number = case when p_command ? 'invoice_number' then entered_number else b.invoice_number end,
        gst_percentage = case when p_command ? 'gst_percentage' then entered_gst else b.gst_percentage end,
        invoice_date = case when p_command ? 'invoice_date' then (p_command->>'invoice_date')::date else b.invoice_date end
      where b.id = invoice_id;
    elsif action in ('save_line', 'remove_line') then
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
      if action = 'save_line' then
        if shadow_id is not null then
          if po_id is not null then raise exception 'Ad-hoc billing owns its PO'; end if;
          po_id := old_line.po_item_id;
        else
          perform id from garments_erp.po_item
          where id in (po_id, old_line.po_item_id) order by id for update;
          select p.* into strict po_line
          from garments_erp.po_item p
          join garments_erp.buyer_po h on h.id = p.buyer_po_id
          where p.id = po_id and h.id = formal_id and h.cancelled_at is null
          for share of h;
        end if;
      end if;

      if action = 'save_line' and invoice_mode = 'standard' then
        if sets is null or sets < 1 then raise exception 'Positive set quantity required'; end if;
        variation_id := coalesce(variation_id, po_line.sellable_product_id);
        if shadow_id is null and (
          po_line.ordered_units is null or po_line.sellable_product_id is distinct from variation_id
        ) then raise exception 'Standard billing requires a matching standard PO line'; end if;
        set_price := (p_command->>'unit_price')::numeric;
        if set_price is null or set_price < 0 or set_price >= 'Infinity'::numeric then
          raise exception 'Explicit unit price required';
        end if;
        perform 1 from garments_erp.sellable_product
        where id = variation_id and is_active and verified_at is not null
          and verified_by_employee_id is not null for share;
        if not found then raise exception 'Verified active product required'; end if;
        if version_id is not null then
          perform 1 from garments_erp.item_in_store_price
          where id = version_id and sellable_product_id = variation_id for share;
          if not found then raise exception 'Price version belongs to another product'; end if;
        end if;
        if shadow_id is null then
          select jsonb_agg(jsonb_build_object(
            'size_id', item_size_list_id, 'pieces', share_weight::bigint * sets, 'weight', share_weight
          )) into components from garments_erp.po_item_piece_per_size where po_item_id = po_id;
          if exists (
            select 1
            from (select item_size_list_id, share_weight from garments_erp.po_item_piece_per_size
                  where po_item_id = po_id) ordered
            full join (select item_size_list_id, share_weight from garments_erp.sellable_unit
                       where sellable_product_id = variation_id) recipe using (item_size_list_id)
            where ordered.share_weight is distinct from recipe.share_weight
          ) then raise exception 'PO composition differs from the verified product'; end if;
          if exists (
            select 1 from garments_erp.po_item_piece_per_size
            where po_item_id = po_id and (
              share_weight is null or pieces_ordered <> share_weight::bigint * po_line.ordered_units
            )
          ) then raise exception 'Invalid standard PO composition'; end if;
        else
          select jsonb_agg(jsonb_build_object(
            'size_id', item_size_list_id, 'pieces', share_weight::bigint * sets, 'weight', share_weight
          )) into components from garments_erp.sellable_unit where sellable_product_id = variation_id;
        end if;
      elsif action = 'save_line' then
        if variation_id is not null or version_id is not null or sets is not null then
          raise exception 'Exception billing takes only physical pieces and prices';
        end if;
        if po_line.sellable_product_id is not null then
          raise exception 'Exception billing requires an exception PO line';
        end if;
        components := p_command->'pieces';
      else
        components := '[]'::jsonb;
      end if;

      if action = 'save_line' and (
        jsonb_typeof(components) is distinct from 'array' or components = '[]'::jsonb
      ) then raise exception 'At least one size component required'; end if;
      if action = 'save_line' and exists (
        select 1 from jsonb_array_elements(components) part
        where not exists (
          select 1 from garments_erp.item_produced_pieces produced
          where produced.item_size_list_id = (part->>'size_id')::bigint and produced.pieces > 0
        )
      ) then raise exception 'Every billed size requires recorded production stock-in'; end if;

      if action = 'save_line' and old_line.sellable_product_id is distinct from variation_id
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


      if action = 'remove_line' then
        if line_id is null then raise exception 'Billing line required'; end if;
        if invoice_status = 'finalized' and not exists (
          select 1 from garments_erp.billing_item where billing_id = invoice_id and id <> line_id
        ) then raise exception 'A finalized invoice requires at least one line'; end if;
        delete from garments_erp.billing_item_piece_per_size where billing_item_id = line_id;
        delete from garments_erp.billing_item where id = line_id;
        if shadow_id is not null then
          delete from garments_erp.po_item_piece_per_size where po_item_id = old_line.po_item_id;
          delete from garments_erp.po_item where id = old_line.po_item_id;
        end if;
      else
        if exists (
          select 1 from jsonb_to_recordset(components) as c(size_id bigint, pieces numeric, price numeric)
          where c.size_id is null or c.pieces is null or c.pieces <= 0 or c.pieces <> trunc(c.pieces)
            or (invoice_mode = 'exception' and c.price is null)
        ) then raise exception 'Each component requires a size, whole pieces and an exception price'; end if;
        if shadow_id is not null then
          if po_product_type_id is null then
            raise exception 'Ad-hoc PO product type required';
          end if;
          if jsonb_typeof(hsn_by_size) is distinct from 'object' or exists (
            select 1 from jsonb_to_recordset(components) as c(size_id bigint)
            where jsonb_typeof(hsn_by_size->(c.size_id::text)) is distinct from 'string'
              or nullif(btrim(hsn_by_size->>(c.size_id::text)), '') is null
          ) then raise exception 'Ad-hoc PO HSN code required for each size'; end if;
          if po_id is null then
            insert into garments_erp.po_item
              (buyer_po_id, sale_mode_type_id, sellable_product_id, ordered_units, unit_price, product_type_list_id)
            values (shadow_id, (select id from garments_erp.sale_mode_type where type = invoice_mode), variation_id, sets, set_price, po_product_type_id) returning id into po_id;
          else
            update garments_erp.po_item set sellable_product_id = variation_id,
              ordered_units = sets, unit_price = set_price, product_type_list_id = po_product_type_id
            where id = po_id;
          end if;
          insert into garments_erp.po_item_piece_per_size
            (po_item_id, item_size_list_id, pieces_ordered, share_weight, price_per_piece, hsn_code)
          select po_id, size_id, pieces, weight, price, btrim(hsn_by_size->>(size_id::text))
          from jsonb_to_recordset(components) as c(size_id bigint, weight integer, pieces numeric, price numeric)
          on conflict (po_item_id, item_size_list_id) do update
          set pieces_ordered = excluded.pieces_ordered, share_weight = excluded.share_weight,
              price_per_piece = excluded.price_per_piece, hsn_code = excluded.hsn_code;
        end if;
        if line_id is null then
          insert into garments_erp.billing_item (
            billing_id, po_item_id, sale_mode_type_id, sellable_product_id, price_version_id, billed_units, unit_price
          ) values (invoice_id, po_id, (select id from garments_erp.sale_mode_type where type = invoice_mode), variation_id, version_id, sets, set_price) returning id into line_id;
        else
          update garments_erp.billing_item
          set po_item_id = po_id, sellable_product_id = variation_id,
              price_version_id = version_id, billed_units = sets, unit_price = set_price
          where id = line_id;
        end if;
        delete from garments_erp.billing_item_piece_per_size p where p.billing_item_id = line_id
          and not exists (select 1 from jsonb_array_elements(components) part where (part->>'size_id')::bigint = p.item_size_list_id);
        insert into garments_erp.billing_item_piece_per_size
          (billing_item_id, item_size_list_id, share_weight, billed_pieces, price_per_piece)
        select line_id, size_id, case when invoice_mode = 'standard' then weight end, pieces,
               case when invoice_mode = 'exception' then price end
        from jsonb_to_recordset(components) as c(size_id bigint, weight numeric, pieces numeric, price numeric)
        on conflict (billing_item_id, item_size_list_id) do update
        set share_weight = excluded.share_weight, billed_pieces = excluded.billed_pieces,
            price_per_piece = excluded.price_per_piece;

        if shadow_id is not null then
          delete from garments_erp.po_item_piece_per_size p where p.po_item_id = po_id
            and not exists (select 1 from garments_erp.billing_item_piece_per_size b
              where b.billing_item_id = line_id and b.item_size_list_id = p.item_size_list_id);
        end if;

        if exists (
          select 1 from garments_erp.billing_item_piece_per_size p
          join garments_erp.finished_balances(null) s on s.size_id = p.item_size_list_id
          left join public.erp_billing_po_allowance(po_id) po on po.item_size_list_id = p.item_size_list_id
          where p.billing_item_id = line_id and (s.available < 0 or po.remaining is null or po.remaining < 0)
        ) then raise exception 'Insufficient physical stock or PO allowance'; end if;
      end if;
      perform garments_erp.check_billing_packing(invoice_id, false);
    elsif action = 'finalize' and invoice_status = 'draft' then
      if not exists (select 1 from garments_erp.billing_item where billing_id = invoice_id) then
        raise exception 'Cannot finalize an empty invoice';
      end if;
      update garments_erp.billing b set billing_status_type_id = (
        select id from garments_erp.billing_status_type where type = 'finalized'
      ), verified_by = p_employee_id, finalized_at = now(),
      invoice_number = case when p_command ? 'invoice_number' then entered_number else b.invoice_number end,
      gst_percentage = case when p_command ? 'gst_percentage' then entered_gst else b.gst_percentage end
      where b.id = invoice_id;
    elsif action = 'cancel' and invoice_status = 'draft' then
      update garments_erp.billing set billing_status_type_id = (
        select id from garments_erp.billing_status_type where type = 'cancelled'
      ) where id = invoice_id;
      update garments_erp.buyer_po set cancelled_at = now() where id = shadow_id;
    else
      raise exception 'Invalid billing command or status transition';
    end if;
  end if;
  insert into garments_erp.billing_audit (request_id, billing_id, employee_id, command, before_state, after_state)
  values (p_request_id, invoice_id, p_employee_id, p_command, previous, garments_erp.billing_snapshot(invoice_id));
  return invoice_id;
end;
$$;

-- Server-side totals use frozen billed prices and verified return values.
create function garments_erp.billing_value(p_billing_id bigint)
returns table (original_value numeric, verified_credit numeric, taxable_value numeric,
               gst_amount numeric, total_including_gst numeric)
language sql stable set search_path = '' as $$
  with amounts as (
    select b.gst_percentage,
      coalesce((
        select sum(case when l.billed_units is not null then l.billed_units * l.unit_price else (
          select sum(bp.billed_pieces * bp.price_per_piece)
          from garments_erp.billing_item_piece_per_size bp where bp.billing_item_id = l.id
        ) end)
        from garments_erp.billing_item l where l.billing_id = b.id
      ), 0) as original,
      coalesce((
        select sum(case when ri.returned_units is not null then ri.returned_units * ri.unit_price else (
          select sum(rp.returned_pieces * rp.returned_price_per_piece)
          from garments_erp.return_bill_item_piece_per_size rp where rp.return_bill_item_id = ri.id
        ) end)
        from garments_erp.return_bill rb
        join garments_erp.return_bill_item ri on ri.return_bill_id = rb.id
        where rb.billing_id = b.id and rb.verified_at is not null
      ), 0) as credits
    from garments_erp.billing b where b.id = p_billing_id
  )
  select original, credits, original - credits,
         (original - credits) * gst_percentage / 100,
         (original - credits) * (1 + gst_percentage / 100)
  from amounts;
$$;

revoke all on function garments_erp.billing_value(bigint) from public, anon, authenticated;
grant execute on function garments_erp.billing_value(bigint) to service_role;

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
  if exists (
    select 1 from garments_erp.return_bill_item ri
    join garments_erp.billing_item bi on bi.id = ri.billing_item_id
    left join garments_erp.return_bill_item_piece_per_size part on part.return_bill_item_id = ri.id
    left join garments_erp.billing_item_piece_per_size bp on bp.id = part.billing_item_piece_per_size_id
    where ri.return_bill_id = result_id and
      coalesce(part.returned_price_per_piece, ri.unit_price) > coalesce(bi.unit_price, bp.price_per_piece)
  ) then raise exception 'Return price exceeds the original billed unit price'; end if;

  if exists (
    select 1 from garments_erp.billing_value(p_billing_id) v
    where v.verified_credit > v.original_value
  ) then raise exception 'Cumulative return credit exceeds original billed value'; end if;

  insert into garments_erp.billing_audit (request_id, billing_id, employee_id, command, after_state)
  values (p_request_id, p_billing_id, p_employee_id, return_command, jsonb_build_object('return_id', result_id));
  return result_id;
end;
$$;

commit;
