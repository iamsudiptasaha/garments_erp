begin;

alter table garments_erp.fabric_type
  add column series smallint unique check (series between 1 and 9);

create table garments_erp.inventory_sku_counter (
  prefix text not null,
  series smallint not null check (series between 1 and 9),
  last_number integer not null check (last_number between 1 and 999),
  primary key (prefix, series)
);
alter table garments_erp.inventory_sku_counter enable row level security;

alter table garments_erp.raw_material_check_in
  add column automatic_dyed_receipt boolean not null default false,
  add constraint automatic_dyed_receipt_source check (
    not automatic_dyed_receipt or dyed_fabric_item_id is not null
  );
create unique index raw_material_one_automatic_dyed_receipt
  on garments_erp.raw_material_check_in(dyed_fabric_item_id) where automatic_dyed_receipt;

create function garments_erp.next_inventory_sku(p_prefix text, p_series smallint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  sku_stem text;
  historical_number integer;
  next_number integer;
begin
  if p_prefix is null or p_prefix !~ '^[A-Z]+$' or p_series is null or p_series not between 1 and 9 then
    raise exception 'A valid SKU prefix and series are required';
  end if;
  sku_stem := p_prefix || '-' || p_series;
  select coalesce(max(substring(sku from length(sku_stem) + 1 for 3)::integer), 0)
    into historical_number
    from garments_erp.raw_material_check_in
    where sku ~ ('^' || sku_stem || '[0-9]{3}($|/)');
  if historical_number = 999 then
    raise exception 'SKU series % is exhausted', sku_stem;
  end if;
  insert into garments_erp.inventory_sku_counter as counter(prefix, series, last_number)
    values (p_prefix, p_series, historical_number + 1)
    on conflict (prefix, series) do update
      set last_number = greatest(counter.last_number, historical_number) + 1
      where counter.last_number < 999
    returning last_number into next_number;
  if next_number is null then
    raise exception 'SKU series % is exhausted', sku_stem;
  end if;
  return sku_stem || lpad(next_number::text, 3, '0');
end $$;

create function garments_erp.dyed_fabric_receipt_price(
  gross_kg numeric, billed_kg numeric, yarn_rate numeric, knitting_rate numeric, dyeing_rate numeric
) returns numeric language sql immutable strict set search_path = '' as $$
  select case when gross_kg > 0 and gross_kg < 'Infinity'::numeric
    then round((yarn_rate + knitting_rate + dyeing_rate) *
      (1 + (gross_kg - billed_kg) / gross_kg), 2)
  end
$$;

create function garments_erp.sync_confirmed_dyed_receipts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  line record;
  receipt garments_erp.raw_material_check_in;
  legacy_quantity numeric;
  issued_quantity numeric;
  reconciled boolean;
begin
  if new.verified_by_employee_id is null then
    return new;
  end if;
  if tg_argv[0] = 'attachment' then
    update garments_erp.raw_material_check_in r set bill_attachment = new.bill_attachment
    from garments_erp.dyed_fabric_item d
    where d.dyed_fabric_bill_id = new.id and r.dyed_fabric_item_id = d.id
      and r.automatic_dyed_receipt and r.bill_attachment is distinct from new.bill_attachment;
    return new;
  end if;
  for line in
    select d.id, d.final_quantity, ft.series,
      garments_erp.dyed_fabric_receipt_price(d.gross_quantity, d.billed_quantity,
        y.billed_rate, k.billed_rate, d.dyeing_rate) as unit_price
    from garments_erp.dyed_fabric_item d
    join garments_erp.dyeing_program_item p on p.id = d.dyeing_program_item_id
    join garments_erp.fabric_type ft on ft.id = p.fabric_type_id
    join garments_erp.knitting_bill_item k on k.id = d.knitting_bill_item_id
    join garments_erp.yarn_bill_item y on y.id = k.yarn_bill_item_id
    where d.dyed_fabric_bill_id = new.id
    order by d.id
    for update of d
  loop
    select * into receipt from garments_erp.raw_material_check_in
      where dyed_fabric_item_id = line.id and automatic_dyed_receipt for update;
    select sum(billed_quantity) into legacy_quantity from garments_erp.raw_material_check_in
      where dyed_fabric_item_id = line.id and not automatic_dyed_receipt;
    if legacy_quantity is not null then
      if line.final_quantity is null or legacy_quantity > line.final_quantity then
        raise exception 'Final quantity is below legacy receipts for dyed fabric item %', line.id;
      end if;
      continue;
    end if;
    if line.final_quantity is null or line.final_quantity <= 0
        or line.final_quantity >= 'Infinity'::numeric or line.unit_price is null
        or line.unit_price < 0 or line.unit_price >= 'Infinity'::numeric then
      if receipt.id is not null then
        raise exception 'Dyed fabric item % already has stock and needs a valid quantity and price', line.id;
      end if;
      continue;
    end if;
    if receipt.id is null then
      if line.series is null then
        raise exception 'Assign the fabric type SKU series before receiving dyed fabric item %', line.id;
      end if;
      insert into garments_erp.raw_material_check_in (
        dyed_fabric_item_id, inward_date, billed_quantity, billed_price, sku,
        invoice_number, bill_attachment, verified_by_employee_id, automatic_dyed_receipt
      ) values (
        line.id, (now() at time zone 'Asia/Kolkata')::date, line.final_quantity, line.unit_price,
        garments_erp.next_inventory_sku('FAB', line.series), new.invoice_number,
        new.bill_attachment, new.verified_by_employee_id, true
      );
    else
      select coalesce(sum(quantity), 0), coalesce(bool_or(reconciliation), false)
        into issued_quantity, reconciled from garments_erp.raw_material_check_out
        where raw_material_check_in_id = receipt.id;
      if line.final_quantity < issued_quantity
          or (reconciled and line.final_quantity <> receipt.billed_quantity) then
        raise exception 'Final quantity conflicts with existing stock issues for dyed fabric item %', line.id;
      end if;
      if issued_quantity > 0 and line.unit_price <> receipt.billed_price then
        raise exception 'Price correction would change issued stock cost for dyed fabric item %', line.id;
      end if;
      update garments_erp.raw_material_check_in
        set billed_quantity = line.final_quantity, billed_price = line.unit_price,
          invoice_number = new.invoice_number, bill_attachment = new.bill_attachment,
          verified_by_employee_id = new.verified_by_employee_id
        where id = receipt.id
          and (billed_quantity, billed_price, invoice_number, bill_attachment, verified_by_employee_id)
            is distinct from (line.final_quantity, line.unit_price, new.invoice_number, new.bill_attachment,
              new.verified_by_employee_id);
    end if;
  end loop;
  return new;
end $$;

create trigger sync_confirmed_dyed_receipts
  after update of verified_by_employee_id on garments_erp.dyed_fabric_bill
  for each row execute function garments_erp.sync_confirmed_dyed_receipts();
create trigger sync_confirmed_dyed_receipt_attachment
  after update of bill_attachment on garments_erp.dyed_fabric_bill
  for each row execute function garments_erp.sync_confirmed_dyed_receipts('attachment');

create function garments_erp.protect_automatic_dyed_receipt()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.automatic_dyed_receipt and pg_trigger_depth() = 1 then
    raise exception 'Automatic dyed stock receipts are maintained by their verified bill';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
create trigger protect_automatic_dyed_receipt
  before update or delete on garments_erp.raw_material_check_in
  for each row execute function garments_erp.protect_automatic_dyed_receipt();

revoke execute on function garments_erp.next_inventory_sku(text, smallint),
  garments_erp.sync_confirmed_dyed_receipts() from public, anon, authenticated;

commit;
