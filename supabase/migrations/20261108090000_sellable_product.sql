begin;
set local lock_timeout = '10s';

do $migration$
begin
  if to_regclass('garments_erp.sellable_product') is not null then
    if to_regclass('garments_erp.item_in_store') is not null
       or to_regclass('garments_erp.item_in_store_variation') is not null then
      raise exception 'Unexpected mixed sellable catalogue schema';
    end if;
    return;
  end if;

  lock table garments_erp.item_in_store, garments_erp.item_in_store_variation,
    garments_erp.sellable_unit, garments_erp.po_item, garments_erp.billing_item,
    garments_erp.item_in_store_price in access exclusive mode;

  if exists (
    select 1 from garments_erp.item_in_store p
    where not exists (
      select 1 from garments_erp.item_in_store_variation v where v.item_in_store_id = p.id
    )
  ) or exists (
    select 1 from garments_erp.item_in_store_variation v
    left join garments_erp.item_in_store p on p.id = v.item_in_store_id
    where p.id is null
  ) then
    raise exception 'Unmapped commercial parent or variation requires reconciliation';
  end if;

  if exists (
    select p.sku from garments_erp.item_in_store p
    join garments_erp.item_in_store_variation v on v.item_in_store_id = p.id
    where p.sku is not null group by p.sku having count(*) > 1
  ) then
    raise exception 'Copied SKUs would violate uniqueness'
      using detail = (
        select string_agg(parent_id::text, ', ' order by parent_id)
        from (
          select p.id as parent_id from garments_erp.item_in_store p
          join garments_erp.item_in_store_variation v on v.item_in_store_id = p.id
          where p.sku is not null group by p.id having count(*) > 1
        ) conflicts
      );
  end if;

  if exists (
    select 1 from garments_erp.item_in_store_variation v
    join garments_erp.item_in_store p on p.id = v.item_in_store_id
    where v.is_active and p.is_active and v.verified_by_employee_id is not null
      and p.verified_by_employee_id is null
  ) then
    raise exception 'Active verified variations with unverified parents require reconciliation';
  end if;

  alter table garments_erp.item_in_store_variation rename to sellable_product;
  alter sequence garments_erp.item_in_store_variation_id_seq rename to sellable_product_id_seq;
  alter table garments_erp.sellable_product
    add column sku text,
    add column style_code text,
    add column date date,
    add column legacy_parent jsonb;

  -- Backfill verified rows while preserving their original timestamps.
  alter table garments_erp.sellable_product disable trigger guard_finished_variation;
  alter table garments_erp.sellable_product disable trigger zz_stamp_updated_at;
  update garments_erp.sellable_product v
  set sku = p.sku, style_code = p.style_code, date = p.date,
      is_active = v.is_active and p.is_active,
      legacy_parent = to_jsonb(p)
  from garments_erp.item_in_store p
  where p.id = v.item_in_store_id;
  alter table garments_erp.sellable_product enable trigger zz_stamp_updated_at;
  alter table garments_erp.sellable_product enable trigger guard_finished_variation;
  alter trigger guard_finished_variation on garments_erp.sellable_product rename to guard_finished_product;
  alter table garments_erp.sellable_product rename constraint item_in_store_variation_pkey to sellable_product_pkey;
  alter table garments_erp.sellable_product rename constraint finished_variation_verification_pair to sellable_product_verification_pair;
  alter table garments_erp.sellable_product add constraint sellable_product_sku_key unique (sku);

  alter table garments_erp.sellable_unit rename column item_in_store_variation_id to sellable_product_id;
  alter table garments_erp.sellable_unit rename constraint sellable_unit_item_in_store_variation_id_fkey to sellable_unit_sellable_product_id_fkey;
  alter table garments_erp.po_item rename column item_in_store_variation_id to sellable_product_id;
  alter table garments_erp.po_item rename constraint po_item_item_in_store_variation_id_fkey to po_item_sellable_product_id_fkey;
  alter table garments_erp.billing_item rename column item_in_store_variation_id to sellable_product_id;
  alter table garments_erp.billing_item rename constraint billing_item_item_in_store_variation_id_fkey to billing_item_sellable_product_id_fkey;
  alter table garments_erp.item_in_store_price rename column item_in_store_variation_id to sellable_product_id;
  alter table garments_erp.item_in_store_price rename constraint item_in_store_price_item_in_store_variation_id_fkey to item_in_store_price_sellable_product_id_fkey;

  alter table garments_erp.sellable_unit rename constraint sellable_unit_item_size_list_id_item_in_store_variation_id_key to sellable_unit_size_product_key;
  alter table garments_erp.item_in_store_price rename constraint item_in_store_price_price_type_id_item_in_store_variation_i_key to item_in_store_price_type_product_version_key;

  alter table garments_erp.sellable_product
    drop constraint item_in_store_variation_item_in_store_id_fkey,
    drop column item_in_store_id restrict;
  drop table garments_erp.item_in_store restrict;
end;
$migration$;

-- Keep the public RPC signatures and payload keys stable for existing callers.
create or replace function garments_access.guard_finished_catalogue() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.legacy_parent is not null then raise exception 'Legacy provenance is migration-managed'; end if;
  elsif tg_op = 'UPDATE' then
    if new.legacy_parent is distinct from old.legacy_parent then
      raise exception 'Legacy provenance is immutable';
    end if;
  end if;
  if tg_op = 'DELETE' then
    if old.verified_by_employee_id is not null then raise exception 'Retire verified configurations instead'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if not old.is_active and new.is_active then raise exception 'Retirement is permanent'; end if;
    if old.verified_by_employee_id is not null then
      if (to_jsonb(new) - array['name', 'is_active', 'updated_at'])
          is distinct from (to_jsonb(old) - array['name', 'is_active', 'updated_at']) then
        raise exception 'Verified commercial configurations are immutable';
      end if;
      return new;
    end if;
  end if;
  if new.verified_by_employee_id is not null then
    if not exists (select 1 from garments_erp.employee e where e.id = new.verified_by_employee_id and e.is_active)
    then raise exception 'Select an active employee'; end if;
      if not exists (select 1 from garments_erp.sellable_unit u where u.sellable_product_id = new.id)
         or exists (
           select 1 from garments_erp.sellable_unit u where u.sellable_product_id = new.id
           and not exists (select 1 from garments_erp.item_produced p where p.item_id = u.item_id)
         ) then raise exception 'Each component item needs verified finished stock-in'; end if;
      new.verified_at := now();
  end if;
  return new;
end;
$$;

create or replace function garments_access.guard_finished_recipe() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_variation bigint;
  new_variation bigint;
  variation record;
begin
  if tg_op <> 'INSERT' then old_variation := old.sellable_product_id; end if;
  if tg_op <> 'DELETE' then new_variation := new.sellable_product_id; end if;
  for variation in
    select v.verified_by_employee_id from garments_erp.sellable_product v
    where v.id in (old_variation, new_variation) order by v.id for update
  loop
    if variation.verified_by_employee_id is not null then raise exception 'Verified packing recipes are immutable'; end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function garments_access.finished_stock(
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
    with balances as materialized (select * from garments_access.finished_balances(null)),
    variations as (
      select v.id, v.name, v.sku,
        min(coalesce(b.available, 0) / u.share_weight) as capacity,
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
          'sku', v.sku, 'capacity', v.capacity, 'components', v.components) order by v.id)
        from (select * from variations order by id limit p_limit offset p_offset) v
      ), '[]'::jsonb)
    )
  );
end;
$$;

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
        join garments_erp.sellable_product v on v.id = pr.sellable_product_id
        where pr.id = version_id and v.id = variation_id
          and v.is_active
          and v.verified_at is not null and v.verified_by_employee_id is not null
          and pr.price >= 0 and pr.price < 'Infinity'::numeric
        for share of pr, v;
        select jsonb_agg(jsonb_build_object(
          'size_id', item_size_list_id, 'pieces', share_weight::bigint * sets,
          'weight', share_weight
        )) into components
        from garments_erp.sellable_unit where sellable_product_id = variation_id;
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
            billing_id, po_item_id, sellable_product_id, price_version_id, set_quantity, billed_price
          ) values (invoice_id, po_id, variation_id, version_id, sets, set_price) returning id into line_id;
        else
          update garments_erp.billing_item
          set po_item_id = po_id, sellable_product_id = variation_id,
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

commit;
