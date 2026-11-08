begin;
set local lock_timeout = '10s';

-- Receipt and issue commands use the same lock so quantity and source checks
-- see the last committed balance, including during reconciliation.
create function garments_access.save_raw_material_transaction(
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
        'dyed_fabric_item_id','raw_material_purchase_order_item_id','invoice_number','verified_by_employee_id'];
    when 'materialIssues' then
      allowed_fields := array['raw_material_check_in_id','date','quantity','check_out_type_id',
        'issue_by_employee_id','variant_item_id','remarks','reconciliation'];
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
        raw_material_purchase_order_item_id, invoice_number, verified_by_employee_id
      ) values (
        receipt.id, 'RCV-' || receipt.id::text, receipt.inward_date, receipt.billed_quantity,
        receipt.billed_price, receipt.raw_material_item_id, receipt.dyed_fabric_item_id,
        receipt.raw_material_purchase_order_item_id, receipt.invoice_number, receipt.verified_by_employee_id
      ) returning to_jsonb(saved) into result;
    else
      update garments_erp.raw_material_check_in as saved set
        inward_date = receipt.inward_date, billed_quantity = receipt.billed_quantity,
        billed_price = receipt.billed_price, raw_material_item_id = receipt.raw_material_item_id,
        dyed_fabric_item_id = receipt.dyed_fabric_item_id,
        raw_material_purchase_order_item_id = receipt.raw_material_purchase_order_item_id,
        invoice_number = receipt.invoice_number, verified_by_employee_id = receipt.verified_by_employee_id
      where id = p_id returning to_jsonb(saved) into result;
    end if;
    return garments_access.fabric_json('raw_material_check_in', result);
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
      issue_by_employee_id, variant_item_id, remarks, reconciliation
    ) values (
      receipt.id, issue.date, issue.quantity, issue.check_out_type_id,
      issue.issue_by_employee_id, issue.variant_item_id, issue.remarks, issue.reconciliation
    ) returning to_jsonb(saved) into result;
  else
    update garments_erp.raw_material_check_out as saved set
      date = issue.date, quantity = issue.quantity, check_out_type_id = issue.check_out_type_id,
      issue_by_employee_id = issue.issue_by_employee_id,
      variant_item_id = issue.variant_item_id, remarks = issue.remarks
    where id = p_id returning to_jsonb(saved) into result;
  end if;
  return garments_access.fabric_json('raw_material_check_out', result);
end;
$$;

create function public.erp_save_raw_material_transaction(
  p_resource text, p_id bigint, p_updated_at timestamptz, p_values jsonb
) returns jsonb
language sql set search_path = '' as $$
  select garments_access.save_raw_material_transaction(p_resource, p_id, p_updated_at, p_values)
$$;

revoke all on function garments_access.save_raw_material_transaction(text,bigint,timestamptz,jsonb),
  public.erp_save_raw_material_transaction(text,bigint,timestamptz,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function garments_access.save_raw_material_transaction(text,bigint,timestamptz,jsonb),
  public.erp_save_raw_material_transaction(text,bigint,timestamptz,jsonb) to authenticated;

-- Return only the relations needed by screens the caller can view.
create function garments_access.raw_material_transaction_snapshot() returns jsonb
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
      'select coalesce(jsonb_agg(garments_access.fabric_json($1,to_jsonb(row)) order by row.id),''[]'')
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

create function public.erp_raw_material_transaction_snapshot() returns jsonb
language sql stable set search_path = '' as $$
  select garments_access.raw_material_transaction_snapshot()
$$;

revoke all on function garments_access.raw_material_transaction_snapshot(),
  public.erp_raw_material_transaction_snapshot() from public, anon, authenticated, service_role;
grant execute on function garments_access.raw_material_transaction_snapshot(),
  public.erp_raw_material_transaction_snapshot() to authenticated;

alter table garments_erp.raw_material_purchase_order
  add column inventory_revision bigint not null default 0;

create function garments_access.save_raw_material_setup(
  p_resource text, p_id bigint, p_updated_at timestamptz, p_values jsonb, p_lines jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  table_name text;
  fields text[];
  columns_sql text;
  values_sql text;
  updates_sql text;
  previous jsonb;
  saved jsonb;
  result jsonb;
  order_id bigint;
  line_id bigint;
  line jsonb;
  kept_ids bigint[] := '{}';
begin
  case p_resource
    when 'materials' then
      table_name := 'raw_material_item';
      fields := array['name','category_list_id','unit_of_measure_id','raw_material_supplier_list_id','description'];
    when 'materialSuppliers' then
      table_name := 'raw_material_supplier_list';
      fields := array['contacts_id','contact_purpose_id','preferred_transport_id'];
    when 'materialCategories' then
      table_name := 'category_list';
      fields := array['type','name','description','type_abbr','series'];
    when 'materialUnits' then
      table_name := 'unit_of_measure';
      fields := array['unit','description'];
    when 'materialIssueTypes' then
      table_name := 'check_out_type';
      fields := array['name','remarks'];
    when 'materialOrders' then
      table_name := 'raw_material_purchase_order';
      fields := array['purchase_order_number','raw_material_supplier_list_id','employee_id'];
    else raise exception 'Unknown Inventory setup screen';
  end case;

  if auth.uid() is null or not garments_access.has_screen_permission(
    p_resource, case when p_id is null then 'create' else 'edit' end
  ) then raise exception 'Inventory write permission required' using errcode = '42501'; end if;

  if jsonb_typeof(p_values) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(p_values) as keys(name) where not name = any(fields)
  ) then raise exception 'Invalid Inventory setup fields'; end if;

  if exists (
    select 1 from unnest(fields) as field(name)
    where name in ('name','unit','purchase_order_number') and nullif(btrim(p_values->>name),'') is null
  ) then raise exception 'A name or purchase order number is required'; end if;

  perform pg_advisory_xact_lock(741208531);
  if p_id is not null then
    execute format('select to_jsonb(row) from garments_erp.%I row where id=$1 for update',table_name)
      into previous using p_id;
    if previous is null or (previous->>'updated_at')::timestamptz is distinct from p_updated_at then
      raise exception 'Inventory record changed. Reload it before saving.' using errcode = '40001';
    end if;

    if p_resource = 'materials'
      and previous->>'unit_of_measure_id' is distinct from p_values->>'unit_of_measure_id'
      and (exists (select 1 from garments_erp.raw_material_check_in where raw_material_item_id=p_id)
        or exists (select 1 from garments_erp.raw_material_purchase_order_item where raw_material_item_id=p_id))
    then raise exception 'A material with stock or orders cannot change units'; end if;

    if p_resource = 'materialOrders'
      and previous->>'raw_material_supplier_list_id' is distinct from p_values->>'raw_material_supplier_list_id'
      and exists (
        select 1 from garments_erp.raw_material_check_in r
        join garments_erp.raw_material_purchase_order_item l on l.id=r.raw_material_purchase_order_item_id
        where l.raw_material_purchase_order_id=p_id
      )
    then raise exception 'An order with receipts cannot change suppliers'; end if;
  end if;

  select string_agg(format('%I',name),','), string_agg(format('input.%I',name),','),
    string_agg(format('%1$I=input.%1$I',name),',')
  into columns_sql, values_sql, updates_sql from unnest(fields) as field(name);

  if p_id is null then
    execute format(
      'insert into garments_erp.%1$I as saved (%2$s)
       select %3$s from jsonb_populate_record(null::garments_erp.%1$I,$1) input returning to_jsonb(saved)',
      table_name, columns_sql, values_sql
    ) into saved using p_values;
  else
    execute format(
      'update garments_erp.%1$I as saved set %2$s
       from jsonb_populate_record(null::garments_erp.%1$I,$1) input where saved.id=$2 returning to_jsonb(saved)',
      table_name, updates_sql
    ) into saved using p_values,p_id;
  end if;

  result := jsonb_build_object('row',garments_access.fabric_json(table_name,saved));
  if p_resource <> 'materialOrders' then return result; end if;

  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 500 then
    raise exception 'Provide between 1 and 500 purchase order lines';
  end if;
  order_id := (saved->>'id')::bigint;
  for line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(line) is distinct from 'object' or exists (
      select 1 from jsonb_object_keys(line) as keys(name)
      where name not in ('id','raw_material_item_id','quantity','price','description')
    ) or not coalesce((line->>'quantity')::numeric > 0 and (line->>'quantity')::numeric < 'Infinity'::numeric
      and (line->>'price')::numeric >= 0 and (line->>'price')::numeric < 'Infinity'::numeric,false)
    then raise exception 'Invalid purchase order line'; end if;

    line_id := (line->>'id')::bigint;
    if line_id is null then
      insert into garments_erp.raw_material_purchase_order_item(
        raw_material_purchase_order_id, raw_material_item_id, quantity, price, description
      ) values (order_id,(line->>'raw_material_item_id')::bigint,(line->>'quantity')::numeric,
        (line->>'price')::numeric,line->>'description') returning id into line_id;
    else
      if line_id = any(kept_ids) then raise exception 'Duplicate purchase order line identity'; end if;
      update garments_erp.raw_material_purchase_order_item set
        raw_material_item_id=(line->>'raw_material_item_id')::bigint,
        quantity=(line->>'quantity')::numeric,price=(line->>'price')::numeric,description=line->>'description'
      where id=line_id and raw_material_purchase_order_id=order_id;
      if not found then raise exception 'Purchase order line is outside this order'; end if;
    end if;
    kept_ids := array_append(kept_ids,line_id);
  end loop;

  delete from garments_erp.raw_material_purchase_order_item
  where raw_material_purchase_order_id=order_id and not id = any(kept_ids);

  -- Line-only edits also advance the optimistic revision of the order.
  update garments_erp.raw_material_purchase_order as orders
  set inventory_revision=orders.inventory_revision+1 where orders.id=order_id returning to_jsonb(orders) into saved;
  return jsonb_build_object(
    'row',garments_access.fabric_json(table_name,saved),
    'lines',(select jsonb_agg(garments_access.fabric_json('raw_material_purchase_order_item',to_jsonb(l)) order by l.id)
      from garments_erp.raw_material_purchase_order_item l where l.raw_material_purchase_order_id=order_id)
  );
end;
$$;

create function public.erp_save_raw_material_setup(
  p_resource text, p_id bigint, p_updated_at timestamptz, p_values jsonb, p_lines jsonb
) returns jsonb
language sql set search_path = '' as $$
  select garments_access.save_raw_material_setup(p_resource,p_id,p_updated_at,p_values,p_lines)
$$;

revoke all on function garments_access.save_raw_material_setup(text,bigint,timestamptz,jsonb,jsonb),
  public.erp_save_raw_material_setup(text,bigint,timestamptz,jsonb,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function garments_access.save_raw_material_setup(text,bigint,timestamptz,jsonb,jsonb),
  public.erp_save_raw_material_setup(text,bigint,timestamptz,jsonb,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
