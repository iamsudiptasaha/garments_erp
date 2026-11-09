begin;

set local lock_timeout = '10s';

create table garments_erp.item_costing_section (
  id smallint generated always as identity primary key,
  section text not null unique
);

insert into garments_erp.item_costing_section (section) values
  ('Fabrics'), ('Trims and Accessories'), ('Production'),
  ('After production'), ('Peripherals');

create table garments_erp.item_costing_peripherals_type (
  id smallint generated always as identity primary key,
  type text not null unique,
  description text not null
);

insert into garments_erp.item_costing_peripherals_type (type, description) values
  ('overhead', 'Gross-up on the four-section subtotal'),
  ('rejection', 'Gross-up on the amount after overhead'),
  ('discount', 'Percentage reduction on the amount after rejection'),
  ('profit', 'Gross-up on the discounted amount for reference');

alter table garments_erp.item_costing_section enable row level security;
alter table garments_erp.item_costing_peripherals_type enable row level security;

revoke all on garments_erp.item_costing_section, garments_erp.item_costing_peripherals_type
  from public, anon, authenticated, service_role;

alter table garments_erp.item_costing_item
  add column item_costing_section_id smallint references garments_erp.item_costing_section (id),
  add column item_costing_peripherals_type_id smallint
    references garments_erp.item_costing_peripherals_type (id),
  add constraint item_costing_peripheral_once unique (item_costing_id, item_costing_peripherals_type_id),
  add constraint item_costing_peripheral_percentage check (
    item_costing_peripherals_type_id is null or (
      variant_item_per_job_id is null and raw_material_check_out_id is null
      and approved_quantity is null and approved_rate is not null
      and approved_rate >= 0 and approved_rate < 100
    )
  );

-- A version can precede production verification. When populated, the
-- relationship must point to a production entry for the same item.
alter table garments_erp.item_produced
  add constraint item_produced_id_item_key unique (id, item_id);

alter table garments_erp.item_costing
  add column item_produced_id bigint,
  add constraint item_costing_produced_same_item_fk
    foreign key (item_produced_id, item_id) references garments_erp.item_produced (id, item_id);

alter table garments_erp.raw_material_check_in
  add column material_category_id bigint references garments_erp.category_list (id);

alter table garments_erp.raw_material_check_out
  add column stage_id bigint references garments_erp.stage (id);

create or replace function garments_erp.save_raw_material_transaction(
  p_resource text, p_id bigint, p_updated_at timestamptz, p_values jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  receipt garments_erp.raw_material_check_in;
  old_receipt garments_erp.raw_material_check_in;
  issue garments_erp.raw_material_check_out;
  old_issue garments_erp.raw_material_check_out;
  issued numeric;
  available numeric;
  batch_quantity numeric;
  received numeric;
  allowed_fields text[];
  result jsonb;
begin
  case p_resource
    when 'materialReceipts' then
      allowed_fields := array['inward_date','billed_quantity','billed_price','raw_material_item_id',
        'dyed_fabric_item_id','raw_material_purchase_order_item_id','invoice_number','verified_by_employee_id','material_category_id'];
    when 'materialIssues' then
      allowed_fields := array['raw_material_check_in_id','date','quantity','check_out_type_id',
        'issue_by_employee_id','variant_item_id','remarks','reconciliation','stage_id'];
    else raise exception 'Unknown Inventory transaction';
  end case;

  if auth.uid() is null or not garments_access.has_screen_permission(
    p_resource, case when p_id is null then 'create' else 'edit' end
  ) then
    raise exception 'Inventory write permission required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_values) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(p_values) as fields(name) where not name = any(allowed_fields)
  ) then
    raise exception 'Invalid Inventory transaction fields';
  end if;

  perform pg_advisory_xact_lock(741208531);
  if p_resource = 'materialReceipts' then
    receipt := jsonb_populate_record(null::garments_erp.raw_material_check_in, p_values);
    if receipt.inward_date is null or receipt.billed_quantity is null
      or not (receipt.billed_quantity > 0 and receipt.billed_quantity < 'Infinity'::numeric)
      or (receipt.billed_price is not null and not (
        receipt.billed_price >= 0 and receipt.billed_price < 'Infinity'::numeric
      ))
      or num_nonnulls(receipt.raw_material_item_id, receipt.dyed_fabric_item_id) <> 1
      or (receipt.raw_material_item_id is not null and receipt.raw_material_purchase_order_item_id is null)
      or (receipt.dyed_fabric_item_id is not null and receipt.raw_material_purchase_order_item_id is not null)
    then
      raise exception 'Receipt requires a valid source, date, quantity and price';
    end if;

    if p_id is not null then
      select * into old_receipt from garments_erp.raw_material_check_in where id = p_id for update;
      if not found or old_receipt.updated_at is distinct from p_updated_at then
        raise exception 'Receipt changed. Reload it before saving.' using errcode = '40001';
      end if;
      select sum(quantity) into issued from garments_erp.raw_material_check_out
        where raw_material_check_in_id = p_id;
      if issued is not null and (
        receipt.billed_quantity < issued
        or (receipt.raw_material_item_id, receipt.dyed_fabric_item_id, receipt.raw_material_purchase_order_item_id)
          is distinct from (old_receipt.raw_material_item_id, old_receipt.dyed_fabric_item_id,
            old_receipt.raw_material_purchase_order_item_id)
      ) then
        raise exception 'Receipt source or quantity conflicts with existing stock issues';
      end if;
      if receipt.billed_quantity is distinct from old_receipt.billed_quantity and exists (
        select 1 from garments_erp.raw_material_check_out
        where raw_material_check_in_id = p_id and reconciliation
      ) then
        raise exception 'Reconciled stock cannot be reopened by editing its receipt';
      end if;
    end if;

    if receipt.dyed_fabric_item_id is not null then
      select final_quantity into batch_quantity from garments_erp.dyed_fabric_item
        where id = receipt.dyed_fabric_item_id for update;
      select coalesce(sum(billed_quantity), 0) into received from garments_erp.raw_material_check_in
        where dyed_fabric_item_id = receipt.dyed_fabric_item_id and id is distinct from p_id;
      if batch_quantity is null or received + receipt.billed_quantity > batch_quantity then
        raise exception 'Stock receipts exceed the final dyed-fabric quantity';
      end if;
    end if;

    if p_id is null then
      receipt.id := nextval(pg_get_serial_sequence('garments_erp.raw_material_check_in', 'id'));
      insert into garments_erp.raw_material_check_in as saved (
        id, sku, inward_date, billed_quantity, billed_price, raw_material_item_id, dyed_fabric_item_id,
        raw_material_purchase_order_item_id, invoice_number, verified_by_employee_id, material_category_id
      ) values (
        receipt.id, 'RCV-' || receipt.id::text, receipt.inward_date, receipt.billed_quantity,
        receipt.billed_price, receipt.raw_material_item_id, receipt.dyed_fabric_item_id,
        receipt.raw_material_purchase_order_item_id, receipt.invoice_number, receipt.verified_by_employee_id, receipt.material_category_id
      ) returning to_jsonb(saved) into result;
    else
      update garments_erp.raw_material_check_in as saved set
        inward_date = receipt.inward_date, billed_quantity = receipt.billed_quantity,
        billed_price = receipt.billed_price, raw_material_item_id = receipt.raw_material_item_id,
        dyed_fabric_item_id = receipt.dyed_fabric_item_id,
        raw_material_purchase_order_item_id = receipt.raw_material_purchase_order_item_id,
        invoice_number = receipt.invoice_number, verified_by_employee_id = receipt.verified_by_employee_id,
        material_category_id = case when p_values ? 'material_category_id'
          then receipt.material_category_id else saved.material_category_id end
      where id = p_id returning to_jsonb(saved) into result;
    end if;
    return garments_erp.fabric_json('raw_material_check_in', result);
  end if;

  issue := jsonb_populate_record(null::garments_erp.raw_material_check_out, p_values);
  issue.reconciliation := coalesce(issue.reconciliation, false);
  if issue.date is null or issue.quantity is null
    or not (issue.quantity > 0 and issue.quantity < 'Infinity'::numeric)
    or (not issue.reconciliation and issue.check_out_type_id is null)
  then
    raise exception 'Issue requires a valid date, quantity and type';
  end if;

  if p_id is not null then
    select * into old_issue from garments_erp.raw_material_check_out where id = p_id for update;
    if not found or old_issue.updated_at is distinct from p_updated_at then
      raise exception 'Issue changed. Reload it before saving.' using errcode = '40001';
    end if;
    if old_issue.reconciliation or issue.reconciliation
      or old_issue.raw_material_check_in_id is distinct from issue.raw_material_check_in_id
    then
      raise exception 'Issue source and reconciliation records cannot change';
    end if;
  end if;

  select * into receipt from garments_erp.raw_material_check_in
    where id = issue.raw_material_check_in_id for update;
  if not found then
    raise exception 'Source receipt does not exist';
  end if;
  select receipt.billed_quantity - coalesce(sum(quantity), 0) into available
    from garments_erp.raw_material_check_out
    where raw_material_check_in_id = receipt.id and id is distinct from p_id;
  if issue.quantity > available or exists (
    select 1 from garments_erp.raw_material_check_out
    where raw_material_check_in_id = receipt.id and reconciliation
  ) then
    raise exception 'Issue exceeds available stock or receipt is closed';
  end if;
  if issue.reconciliation and (
    issue.quantity <> available or issue.issue_by_employee_id is null
    or nullif(btrim(issue.remarks), '') is null or issue.variant_item_id is not null
  ) then
    raise exception 'Reconciliation requires the remaining stock, issuing employee and reason';
  end if;

  if p_id is null then
    insert into garments_erp.raw_material_check_out as saved (
      raw_material_check_in_id, date, quantity, check_out_type_id,
      issue_by_employee_id, variant_item_id, remarks, reconciliation, stage_id
    ) values (
      receipt.id, issue.date, issue.quantity, issue.check_out_type_id,
      issue.issue_by_employee_id, issue.variant_item_id, issue.remarks, issue.reconciliation, issue.stage_id
    ) returning to_jsonb(saved) into result;
  else
    update garments_erp.raw_material_check_out as saved set
      date = issue.date, quantity = issue.quantity, check_out_type_id = issue.check_out_type_id,
      issue_by_employee_id = issue.issue_by_employee_id,
      variant_item_id = issue.variant_item_id, remarks = issue.remarks,
        stage_id = case when p_values ? 'stage_id' then issue.stage_id else saved.stage_id end
    where id = p_id returning to_jsonb(saved) into result;
  end if;
  return garments_erp.fabric_json('raw_material_check_out', result);
end;
$$;

create or replace function garments_erp.raw_material_transaction_snapshot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  can_receive boolean := garments_access.has_screen_permission('materialReceipts', 'view');
  can_issue boolean := garments_access.has_screen_permission('materialIssues', 'view');
  can_move boolean := garments_access.has_screen_permission('materialMovements','view');
  can_read_stock boolean := garments_access.has_screen_permission('materialStock', 'view');
  can_material boolean := garments_access.has_screen_permission('materials','view');
  can_supplier boolean := garments_access.has_screen_permission('materialSuppliers','view');
  can_order boolean := garments_access.has_screen_permission('materialOrders','view');
  can_category boolean := garments_access.has_screen_permission('materialCategories','view');
  can_unit boolean := garments_access.has_screen_permission('materialUnits','view');
  can_issue_type boolean := garments_access.has_screen_permission('materialIssueTypes','view');
  relation_name text;
  tables text[] := '{}';
  rows jsonb;
  result jsonb := '{}'::jsonb;
begin
  if auth.uid() is null or not coalesce(can_receive or can_issue or can_read_stock or can_move
    or can_material or can_supplier or can_order or can_category or can_unit or can_issue_type, false) then
    raise exception 'Inventory view permission required' using errcode = '42501';
  end if;

  if can_issue then tables := tables || array['stage']; end if;
  if can_receive or can_issue or can_read_stock or can_move then
    tables := tables || array['raw_material_check_out'];
  end if;
  if can_receive or can_issue or can_read_stock or can_move or can_material or can_order then
    tables := tables || array['raw_material_check_in','raw_material_item','raw_material_purchase_order_item'];
  end if;
  if can_receive or can_issue or can_read_stock or can_move or can_order or can_supplier then
    tables := tables || array['raw_material_purchase_order'];
  end if;
  if can_receive or can_issue or can_read_stock or can_move or can_material or can_order or can_supplier then
    tables := tables || array['raw_material_supplier_list'];
  end if;
  if can_receive or can_issue or can_read_stock or can_move or can_material or can_category then
    tables := tables || array['category_list'];
  end if;
  if can_receive or can_issue or can_read_stock or can_move or can_material or can_order or can_unit then
    tables := tables || array['unit_of_measure'];
  end if;
  if can_issue or can_move or can_issue_type then
    tables := tables || array['check_out_type'];
  end if;
  if can_issue or can_move then
    tables := tables || array['item','item_part','part_list','variant','variant_item'];
  end if;
  if can_supplier then
    tables := tables || array['contact_purpose'];
  end if;
  foreach relation_name in array tables loop
    execute format(
      'select coalesce(jsonb_agg(garments_erp.fabric_json($1,to_jsonb(row)) order by row.id),''[]'')
        from garments_erp.%I row', relation_name
    ) into rows using relation_name;
    result := result || jsonb_build_object(relation_name, rows);
  end loop;
  return result || jsonb_build_object(
    'inventory_dyed_batches', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id::text, 'batch', coalesce(b.batch_no, 'Batch ' || d.id::text),
      'name', coalesce(f.name, 'Dyed fabric'), 'final_quantity', d.final_quantity
    ) order by d.id), '[]') from garments_erp.dyed_fabric_item d
      left join garments_erp.batch_no_lab_dip_version_map b on b.dyed_fabric_item_id = d.id
      left join garments_erp.knitting_bill_item k on k.id = d.knitting_bill_item_id
      left join garments_erp.fabric_type f on f.id = k.fabric_type_id
    where can_receive or ((can_issue or can_read_stock or can_move) and exists (
      select 1 from garments_erp.raw_material_check_in r where r.dyed_fabric_item_id = d.id
    ))),
    'transporter', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id::text, 'name', c.company_name
    ) order by t.id), '[]') from garments_erp.transporter t
      join garments_erp.contacts c on c.id=t.contacts_id where can_supplier),
    'employee', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id::text, 'name', c.company_name, 'employeeCode', e.employee_code
    ) order by e.id), '[]') from garments_erp.employee e
      join garments_erp.contacts c on c.id = e.contacts_id
      where can_receive or can_issue or can_move or can_order),
    'contacts', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id::text, 'company_name', c.company_name
    ) order by c.id), '[]') from garments_erp.contacts c
    where can_supplier or ((can_receive or can_issue or can_move or can_read_stock or can_material or can_order)
      and exists (select 1 from garments_erp.raw_material_supplier_list s where s.contacts_id = c.id)))
  );
end;
$$;

commit;
