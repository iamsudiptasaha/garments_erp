begin;
set local lock_timeout = '10s';

alter table garments_erp.raw_material_check_in
  add column is_transferable boolean not null default false,
  add constraint transferable_receipt_source check (not is_transferable or (
    raw_material_purchase_order_item_id is not null and raw_material_item_id is not null
    and dyed_fabric_item_id is null and not automatic_dyed_receipt
  ));

create table garments_erp.transferable_item_movement_type (
  id bigint primary key,
  type text not null unique,
  constraint controlled_transferable_movement_type check (
    (id,type) in ((1,'Transfer'),(2,'Return'),(3,'Discard'),(4,'Restore')))
);
insert into garments_erp.transferable_item_movement_type values
  (1,'Transfer'),(2,'Return'),(3,'Discard'),(4,'Restore');
create table garments_erp.transferable_item_movement (
  id bigint generated always as identity primary key,
  raw_material_check_in_id bigint not null references garments_erp.raw_material_check_in(id) on delete restrict,
  transferable_item_movement_type_id bigint not null references garments_erp.transferable_item_movement_type(id) on delete restrict,
  job_worker_id bigint references garments_erp.job_worker(id) on delete restrict,
  item_id bigint references garments_erp.item(id) on delete restrict,
  employee_id bigint not null references garments_erp.employee(id) on delete restrict,
  movement_at timestamptz not null,
  remarks text,
  constraint transferable_assignment check (
    (transferable_item_movement_type_id in (1,2) and job_worker_id is not null and item_id is not null)
    or (transferable_item_movement_type_id in (3,4) and job_worker_id is null and item_id is null))
);
create index if not exists raw_material_check_out_receipt_history on garments_erp.raw_material_check_out(raw_material_check_in_id);
create index transferable_movement_receipt_order on garments_erp.transferable_item_movement
  (raw_material_check_in_id, movement_at desc, id desc);
create index transferable_movement_worker on garments_erp.transferable_item_movement(job_worker_id);
create index transferable_movement_item on garments_erp.transferable_item_movement(item_id);
create index transferable_movement_employee on garments_erp.transferable_item_movement(employee_id);
alter table garments_erp.transferable_item_movement enable row level security;
alter table garments_erp.transferable_item_movement_type enable row level security;
revoke all on garments_erp.transferable_item_movement, garments_erp.transferable_item_movement_type
  from public, anon, authenticated, service_role;
revoke all on sequence garments_erp.transferable_item_movement_id_seq from public, anon, authenticated, service_role;

-- Lock BEFORE rows, including direct DML and existing commands. READ COMMITTED
-- refreshes the transition query after a waiting lock; other isolation levels retry.
create function garments_erp.lock_transferable_inventory() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Inventory writes require READ COMMITTED; retry the transaction' using errcode='40001';
  end if;
  perform pg_advisory_xact_lock(741208531);
  return null;
end $$;
create trigger aa_transferable_inventory_lock before insert or update or delete
  on garments_erp.raw_material_check_in for each statement execute function garments_erp.lock_transferable_inventory();
create trigger aa_transferable_inventory_lock before insert or update or delete
  on garments_erp.raw_material_check_out for each statement execute function garments_erp.lock_transferable_inventory();
create trigger aa_transferable_inventory_lock before insert or update or delete
  on garments_erp.transferable_item_movement for each statement execute function garments_erp.lock_transferable_inventory();

create function garments_erp.reject_transferable_history_change() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'Inventory history and movement types cannot be edited, deleted or truncated' using errcode='23514';
end $$;
create trigger immutable_transferable_movement before update or delete on garments_erp.transferable_item_movement
  for each row execute function garments_erp.reject_transferable_history_change();
create trigger immutable_transferable_movement_type before insert or update or delete
  on garments_erp.transferable_item_movement_type for each statement execute function garments_erp.reject_transferable_history_change();
create trigger immutable_transferable_movement_truncate before truncate on garments_erp.transferable_item_movement
  for each statement execute function garments_erp.reject_transferable_history_change();
create trigger immutable_transferable_type_truncate before truncate on garments_erp.transferable_item_movement_type
  for each statement execute function garments_erp.reject_transferable_history_change();
create trigger preserve_stock_out_truncate before truncate on garments_erp.raw_material_check_out
  for each statement execute function garments_erp.reject_transferable_history_change();
create trigger preserve_stock_in_truncate before truncate on garments_erp.raw_material_check_in
  for each statement execute function garments_erp.reject_transferable_history_change();

create function garments_erp.guard_transferable_receipt() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op <> 'INSERT' then
    if exists (select 1 from garments_erp.transferable_item_movement where raw_material_check_in_id=old.id) then
      if tg_op='DELETE' then raise exception 'Receipt with movement history cannot be deleted' using errcode='23514'; end if;
      if (new.id,new.sku,new.raw_material_item_id,new.dyed_fabric_item_id,new.raw_material_purchase_order_item_id,
          new.billed_quantity,new.inward_date,new.material_category_id,new.is_transferable)
        is distinct from (old.id,old.sku,old.raw_material_item_id,old.dyed_fabric_item_id,old.raw_material_purchase_order_item_id,
          old.billed_quantity,old.inward_date,old.material_category_id,old.is_transferable) then
        raise exception 'Receipt identity, quantity and transferability are locked by movement history' using errcode='23514';
      end if;
    end if;
    if tg_op='DELETE' then return old; end if;
  end if;
  if (tg_op='INSERT' and new.is_transferable) or (tg_op='UPDATE' and new.is_transferable is distinct from old.is_transferable) then
    if not garments_access.has_screen_permission('materialReceipts',case when tg_op='INSERT' then 'create' else 'edit' end) then
      raise exception 'Inventory write permission required' using errcode='42501';
    end if;
    if new.is_transferable and exists (select 1 from garments_erp.raw_material_check_out where raw_material_check_in_id=new.id) then
      raise exception 'Any Stock Out history prevents enabling transferability' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
create trigger guard_transferable_receipt before insert or update or delete on garments_erp.raw_material_check_in
  for each row execute function garments_erp.guard_transferable_receipt();

create function garments_erp.guard_transferable_stock_out() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Existing issue editing remains supported, but receipt history cannot be erased.
  if tg_op='DELETE' then
    raise exception 'Stock Out history cannot be deleted' using errcode='23514';
  end if;
  if tg_op='UPDATE' and (old.id,old.raw_material_check_in_id) is distinct from (new.id,new.raw_material_check_in_id) then
    raise exception 'Stock Out receipt identity cannot change' using errcode='23514';
  end if;
  if exists (select 1 from garments_erp.raw_material_check_in where id=new.raw_material_check_in_id and is_transferable) then
    raise exception 'Transferable receipts cannot enter Stock Out or reconciliation' using errcode='23514';
  end if;
  return new;
end $$;
create trigger guard_transferable_stock_out before insert or update or delete on garments_erp.raw_material_check_out
  for each row execute function garments_erp.guard_transferable_stock_out();

-- This is the only transition engine. RPCs and projections reuse it.
create function garments_erp.transferable_actions(p_last_type bigint) returns text[]
language sql immutable set search_path='' as $$
  select case p_last_type when 1 then array['Return'] when 3 then array['Restore']
    else array['Transfer','Discard'] end
$$;
create function garments_erp.guard_transferable_movement() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  receipt garments_erp.raw_material_check_in;
  previous garments_erp.transferable_item_movement;
  action text;
begin
  if auth.uid() is null or not garments_access.has_screen_permission('transferableMaterials','view')
    or not garments_access.has_screen_permission('transferableMaterials','create') then
    raise exception 'Transferable Materials movement permission required' using errcode='42501';
  end if;
  select * into receipt from garments_erp.raw_material_check_in where id=new.raw_material_check_in_id for update;
  if receipt.id is null or not receipt.is_transferable then
    raise exception 'Movement requires a transferable PO receipt' using errcode='23514';
  end if;
  select * into previous from garments_erp.transferable_item_movement
    where raw_material_check_in_id=receipt.id order by movement_at desc,id desc limit 1;
  select type into action from garments_erp.transferable_item_movement_type where id=new.transferable_item_movement_type_id;
  if action is null then raise exception 'Invalid movement type' using errcode='23503'; end if;
  if not action=any(garments_erp.transferable_actions(previous.transferable_item_movement_type_id)) then
    raise exception 'Invalid movement for current receipt state. Reload and review again.' using errcode='23514';
  end if;
  if action='Return' then
    new.job_worker_id:=previous.job_worker_id;
    new.item_id:=previous.item_id;
  end if;
  if action in ('Discard','Restore') and nullif(btrim(new.remarks),'') is null then
    raise exception 'Discard and Restore require a reason' using errcode='23514';
  end if;
  -- Ignore user-entered IDs/time, including OVERRIDING SYSTEM VALUE imports.
  new.id:=nextval('garments_erp.transferable_item_movement_id_seq');
  new.movement_at:=greatest(clock_timestamp(),previous.movement_at+interval '1 microsecond');
  return new;
end $$;
create trigger guard_transferable_movement before insert on garments_erp.transferable_item_movement
  for each row execute function garments_erp.guard_transferable_movement();

create function garments_erp.record_transferable_movement(
  p_receipt_id bigint, p_expected_movement_id bigint, p_receipt_updated_at timestamptz,
  p_type_id bigint, p_job_worker_id bigint, p_item_id bigint, p_employee_id bigint, p_remarks text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt garments_erp.raw_material_check_in; last_id bigint; saved garments_erp.transferable_item_movement;
begin
  if auth.uid() is null or not garments_access.has_screen_permission('transferableMaterials','view')
    or not garments_access.has_screen_permission('transferableMaterials','create') then
    raise exception 'Transferable Materials movement permission required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(741208531);
  select * into receipt from garments_erp.raw_material_check_in where id=p_receipt_id for update;
  select id into last_id from garments_erp.transferable_item_movement where raw_material_check_in_id=p_receipt_id
    order by movement_at desc,id desc limit 1;
  if receipt.id is null or receipt.updated_at is distinct from p_receipt_updated_at or last_id is distinct from p_expected_movement_id then
    raise exception 'Receipt changed. Reload and review again.' using errcode='40001';
  end if;
  insert into garments_erp.transferable_item_movement(raw_material_check_in_id,transferable_item_movement_type_id,
    job_worker_id,item_id,employee_id,remarks) values(p_receipt_id,p_type_id,p_job_worker_id,p_item_id,p_employee_id,p_remarks)
    returning * into saved;
  return garments_erp.fabric_json('transferable_item_movement',to_jsonb(saved));
end $$;
create function public.erp_record_transferable_movement(
  p_receipt_id bigint, p_expected_movement_id bigint, p_receipt_updated_at timestamptz,
  p_type_id bigint, p_job_worker_id bigint, p_item_id bigint, p_employee_id bigint, p_remarks text
) returns jsonb language sql set search_path='' as $$
  select garments_erp.record_transferable_movement(p_receipt_id,p_expected_movement_id,p_receipt_updated_at,
    p_type_id,p_job_worker_id,p_item_id,p_employee_id,p_remarks)
$$;
revoke all on function garments_erp.record_transferable_movement(bigint,bigint,timestamptz,bigint,bigint,bigint,bigint,text),
  public.erp_record_transferable_movement(bigint,bigint,timestamptz,bigint,bigint,bigint,bigint,text) from public,anon,authenticated,service_role;
grant execute on function garments_erp.record_transferable_movement(bigint,bigint,timestamptz,bigint,bigint,bigint,bigint,text),
  public.erp_record_transferable_movement(bigint,bigint,timestamptz,bigint,bigint,bigint,bigint,text) to authenticated;

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
        'dyed_fabric_item_id','raw_material_purchase_order_item_id','invoice_number','verified_by_employee_id','material_category_id','is_transferable'];
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
    receipt.is_transferable := coalesce(receipt.is_transferable,false);
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
        raw_material_purchase_order_item_id, invoice_number, verified_by_employee_id, material_category_id, is_transferable
      ) values (
        receipt.id, 'RCV-' || receipt.id::text, receipt.inward_date, receipt.billed_quantity,
        receipt.billed_price, receipt.raw_material_item_id, receipt.dyed_fabric_item_id,
        receipt.raw_material_purchase_order_item_id, receipt.invoice_number, receipt.verified_by_employee_id, receipt.material_category_id, receipt.is_transferable
      ) returning to_jsonb(saved) into result;
    else
      update garments_erp.raw_material_check_in as saved set
        inward_date = receipt.inward_date, billed_quantity = receipt.billed_quantity,
        billed_price = receipt.billed_price, raw_material_item_id = receipt.raw_material_item_id,
        dyed_fabric_item_id = receipt.dyed_fabric_item_id,
        raw_material_purchase_order_item_id = receipt.raw_material_purchase_order_item_id,
        invoice_number = receipt.invoice_number, verified_by_employee_id = receipt.verified_by_employee_id,
        material_category_id = case when p_values ? 'material_category_id'
          then receipt.material_category_id else saved.material_category_id end,
        is_transferable = case when p_values ? 'is_transferable' then receipt.is_transferable else saved.is_transferable end
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


create function garments_erp.transferable_receipt_projection() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',r.id::text,'status',case when garments_access.has_screen_permission('transferableMaterials','view') then case last.transferable_item_movement_type_id when 1 then 'Transferred' when 3 then 'Discarded' else 'In Stock' end end,
   'last_movement_id',case when garments_access.has_screen_permission('transferableMaterials','view') then last.id::text end,'movement_at',case when garments_access.has_screen_permission('transferableMaterials','view') then last.movement_at end,
   'job_worker_id',case when garments_access.has_screen_permission('transferableMaterials','view') and last.transferable_item_movement_type_id=1 then last.job_worker_id::text end,
   'worker',case when garments_access.has_screen_permission('transferableMaterials','view') and last.transferable_item_movement_type_id=1 then wc.company_name end,
   'item_id',case when garments_access.has_screen_permission('transferableMaterials','view') and last.transferable_item_movement_type_id=1 then last.item_id::text end,
   'item',case when garments_access.has_screen_permission('transferableMaterials','view') and last.transferable_item_movement_type_id=1 then concat_ws(' · ',i.style_code,i.product_description) end,
   'allowed_actions',case when r.is_transferable and garments_access.has_screen_permission('transferableMaterials','create')
      then to_jsonb(garments_erp.transferable_actions(last.transferable_item_movement_type_id)) else '[]'::jsonb end,
   'transferability_lock_reason',case when r.dyed_fabric_item_id is not null or r.raw_material_purchase_order_item_id is null
      then 'Only PO-backed raw-material receipts are eligible.'
      when last.id is not null then 'Transferability is locked by movement history.'
      when exists(select 1 from garments_erp.raw_material_check_out o where o.raw_material_check_in_id=r.id)
      then 'Transferability is locked by Stock Out history.' end,
   'identity_locked',last.id is not null
 ) order by r.id),'[]'::jsonb)
 from garments_erp.raw_material_check_in r
 left join lateral(select * from garments_erp.transferable_item_movement m where m.raw_material_check_in_id=r.id
    order by m.movement_at desc,m.id desc limit 1) last on true
 left join garments_erp.job_worker w on w.id=last.job_worker_id
 left join garments_erp.contacts wc on wc.id=w.contacts_id
 left join garments_erp.item i on i.id=last.item_id
 where garments_access.has_screen_permission('materialReceipts','view')
   or (r.is_transferable and garments_access.has_screen_permission('transferableMaterials','view'))
$$;
create or replace function garments_erp.raw_material_transaction_snapshot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  can_transfer boolean := garments_access.has_screen_permission('transferableMaterials','view');
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
  tables text[] := '{}'::text[];
  rows jsonb;
  result jsonb := '{}'::jsonb;
begin
  if auth.uid() is null or not coalesce(can_transfer or can_receive or can_issue or can_read_stock or can_move
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
  -- Transfer-only viewers receive only eligible receipt identities and lookup
  -- labels, not ordinary inventory, PO prices, invoice metadata or attachments.
  if can_transfer then
    if not (result ? 'raw_material_check_in') then
      result:=result || jsonb_build_object('raw_material_check_in',(
        select coalesce(jsonb_agg(jsonb_build_object('id',r.id::text,'sku',r.sku,
          'raw_material_item_id',r.raw_material_item_id::text,'is_transferable',true,
          'inward_date',r.inward_date,'billed_quantity',r.billed_quantity,'updated_at',r.updated_at)
          order by r.id),'[]') from garments_erp.raw_material_check_in r where r.is_transferable));
    end if;
    if not (result ? 'raw_material_item') then
      result:=result || jsonb_build_object('raw_material_item',(
        select coalesce(jsonb_agg(jsonb_build_object('id',m.id::text,'name',m.name,
          'unit_of_measure_id',m.unit_of_measure_id::text) order by m.id),'[]')
        from garments_erp.raw_material_item m where exists(select 1 from garments_erp.raw_material_check_in r
          where r.is_transferable and r.raw_material_item_id=m.id)));
    end if;
    if not (result ? 'unit_of_measure') then
      result:=result || jsonb_build_object('unit_of_measure',(
        select coalesce(jsonb_agg(jsonb_build_object('id',u.id::text,'unit',u.unit) order by u.id),'[]')
        from garments_erp.unit_of_measure u where exists(select 1 from garments_erp.raw_material_item m
          join garments_erp.raw_material_check_in r on r.raw_material_item_id=m.id
          where r.is_transferable and m.unit_of_measure_id=u.id)));
    end if;
  end if;
  return result || jsonb_build_object(
    'transferable_receipt_state',garments_erp.transferable_receipt_projection(),
    'transferable_item_movement_type',(select coalesce(jsonb_agg(jsonb_build_object('id',id::text,'type',type) order by id),'[]') from garments_erp.transferable_item_movement_type where can_transfer),
    'transferable_item_movement',(select coalesce(jsonb_agg(garments_erp.fabric_json('transferable_item_movement',to_jsonb(m)) || jsonb_build_object('type',t.type,'worker',wc.company_name,'item',concat_ws(' · ',i.style_code,i.product_description),'employee',ec.company_name) order by m.movement_at,m.id),'[]') from garments_erp.transferable_item_movement m join garments_erp.transferable_item_movement_type t on t.id=m.transferable_item_movement_type_id left join garments_erp.job_worker w on w.id=m.job_worker_id left join garments_erp.contacts wc on wc.id=w.contacts_id left join garments_erp.item i on i.id=m.item_id left join garments_erp.employee e on e.id=m.employee_id left join garments_erp.contacts ec on ec.id=e.contacts_id where can_transfer),
    'transferable_workers',(select coalesce(jsonb_agg(jsonb_build_object('id',w.id::text,'name',c.company_name) order by w.id),'[]') from garments_erp.job_worker w join garments_erp.contacts c on c.id=w.contacts_id where can_transfer),
    'transferable_items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id::text,'name',concat_ws(' · ',i.style_code,i.product_description)) order by i.id),'[]') from garments_erp.item i where can_transfer),
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
      where can_transfer or can_receive or can_issue or can_move or can_order),
    'contacts', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id::text, 'company_name', c.company_name
    ) order by c.id), '[]') from garments_erp.contacts c
    where can_supplier or ((can_receive or can_issue or can_move or can_read_stock or can_material or can_order)
      and exists (select 1 from garments_erp.raw_material_supplier_list s where s.contacts_id = c.id)))
  );
end;
$$;


-- No new resource is silently granted to custom roles. System administrators
-- continue to use the existing resource/operation ceiling machinery.
insert into garments_access.app_resource(key,name,resource_type,parent_resource_id,route,sort_order,is_active,admin_only)
 values ('transferableMaterials','Transferable Materials','screen',(select id from garments_access.app_resource where key='section:inventory'),'fabric.html#transferableMaterials',36,true,false)
 on conflict(key) do nothing;
insert into garments_access.app_db_table(schema_name,table_name) values
 ('garments_erp','transferable_item_movement'),('garments_erp','transferable_item_movement_type')
 on conflict(schema_name,table_name) do nothing;
insert into garments_access.app_resource_table(app_resource_id,app_db_table_id,relation_type,can_view,can_create,can_edit,can_delete)
 select r.id,t.id,case when t.table_name='transferable_item_movement' then 'primary' else 'lookup' end,
 true,t.table_name='transferable_item_movement',false,false
 from garments_access.app_resource r cross join garments_access.app_db_table t
 where r.key='transferableMaterials' and t.schema_name='garments_erp'
   and t.table_name in ('transferable_item_movement','transferable_item_movement_type','raw_material_check_in','raw_material_item','job_worker','item','employee')
 on conflict(app_resource_id,app_db_table_id) do nothing;

revoke all on function garments_erp.lock_transferable_inventory(),garments_erp.reject_transferable_history_change(),
 garments_erp.guard_transferable_receipt(),garments_erp.guard_transferable_stock_out(),garments_erp.guard_transferable_movement(),
 garments_erp.transferable_actions(bigint),garments_erp.transferable_receipt_projection() from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
commit;
