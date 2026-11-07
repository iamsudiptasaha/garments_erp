-- Disposable CI database. All fixtures roll back.
\set ON_ERROR_STOP on
begin;

insert into garments_erp.stage_type (id, name) values (982001, 'Billing test completion');
insert into garments_erp.stage (id, name, abbr, sort_order, stage_type_id)
values (982001, 'Billing test completion', 'BTC', 982001, 982001);
insert into garments_erp.item (id, style_code) values (982001, 'Billing test');
insert into garments_erp.part_list (id, part) values (982001, 'Billing test body');
insert into garments_erp.item_part (id, item_id, part_list_id) values (982001, 982001, 982001);
insert into garments_erp.size_list (id, size) values (982001, 'Billing test S');
insert into garments_erp.item_size_list (id, item_id, size_list_id) values (982001, 982001, 982001);
insert into garments_erp.production (id, item_part_id) overriding system value values (982001, 982001);
insert into garments_erp.job (id, production_id, stage_id, job_code, latest)
values (982001, 982001, 982001, 'BILL-TEST-JOB', true);
insert into garments_erp.item_produced (id, item_id, completed_job_id, verified_by, request_id)
values (982001, 982001, 982001, 900002, gen_random_uuid());
insert into garments_erp.item_produced_pieces (item_produced_id, item_size_list_id, pieces)
values (982001, 982001, 10);
update garments_erp.item set is_locked = true where id = 982001;

insert into garments_erp.item_in_store (id, sku, verified_by_employee_id)
values (982001, 'BILLING-TEST', 900002);
insert into garments_erp.item_in_store_variation (id, item_in_store_id, name)
values (982001, 982001, 'Test set');
insert into garments_erp.sellable_unit (item_in_store_variation_id, item_id, item_size_list_id, share_weight)
values (982001, 982001, 982001, 2);
update garments_erp.item_in_store_variation set verified_by_employee_id = 900002 where id = 982001;
insert into garments_erp.price_type (id, name) values (982001, 'Billing test price');
insert into garments_erp.item_in_store_price
  (id, item_in_store_variation_id, price_type_id, version, price)
values (982001, 982001, 982001, 'Billing v1', 120);

insert into garments_erp.buyer_list (id, buyer_name) values (982001, 'Billing test buyer');
insert into garments_erp.buyer_po (id, po_number, buyer_list_id) values (982001, 'BILL-TEST-PO', 982001);
insert into garments_erp.po_item (id, buyer_po_id) values (982001, 982001), (982002, 982001);
insert into garments_erp.po_item_piece_per_size (po_item_id, item_size_list_id, pieces_ordered)
values (982001, 982001, 6), (982002, 982001, 20);
insert into garments_erp.transporter (id, contact_purpose_id, contacts_id) values (982001, 900001, 900002);

do $$
declare
  standard_id bigint;
  exception_id bigint;
  cancelled_id bigint;
  standard_line bigint;
  exception_line bigint;
  carton_a bigint;
  carton_b bigint;
  carton_c bigint;
  component_id bigint;
  exception_component bigint;
  transport_a bigint;
  transport_b bigint;
  request_id uuid := gen_random_uuid();
  line jsonb;
begin
  standard_id := public.erp_billing_command(request_id, 900002,
    '{"action":"create","invoice_number":"BILL-STD","mode":"standard"}');
  if standard_id <> public.erp_billing_command(request_id, 900002,
    '{"action":"create","invoice_number":"BILL-STD","mode":"standard"}') then
    raise exception 'TEST: request retry did not preserve invoice identity';
  end if;
  cancelled_id := public.erp_billing_command(gen_random_uuid(), 900002,
    '{"action":"create","invoice_number":"BILL-CANCEL","mode":"exception"}');
  perform public.erp_billing_command(gen_random_uuid(), 900002, jsonb_build_object(
    'action','save_line','billing_id',cancelled_id,'po_item_id',982001,
    'pieces','[{"size_id":982001,"pieces":2,"price":40}]'::jsonb));
  if (select (on_hand, held, available) from public.erp_billing_stock(982001))
    is distinct from row(10::bigint,2::bigint,8::bigint) then
    raise exception 'TEST: draft hold changes physical stock';
  end if;
  perform public.erp_billing_command(gen_random_uuid(), 900002,
    jsonb_build_object('action','cancel','billing_id',cancelled_id));
  if (select available from garments_access.finished_balances(982001)) <> 10
    or (select remaining from public.erp_billing_po_allowance(982001)) <> 6
    or not exists (select 1 from garments_erp.billing_item where billing_id = cancelled_id) then
    raise exception 'TEST: cancellation failed to release holds and preserve invoice lines';
  end if;
  exception_id := public.erp_billing_command(gen_random_uuid(), 900002,
    '{"action":"create","invoice_number":"BILL-EX","mode":"exception"}');
  line := jsonb_build_object('action','save_line','billing_id',standard_id,
    'po_item_id',982001,'variation_id',982001,'price_version_id',982001,'sets',2);
  perform public.erp_billing_command(gen_random_uuid(), 900002, line);
  select id into strict standard_line from garments_erp.billing_item where billing_id = standard_id;
  line := line || jsonb_build_object('line_id', standard_line);
  select id into strict component_id from garments_erp.billing_item_piece_per_size where billing_item_id = standard_line;
  if (select available from garments_access.finished_balances(982001)) <> 6
    or (select remaining from public.erp_billing_po_allowance(982001)) <> 2 then
    raise exception 'TEST: draft hold or PO allowance incorrect';
  end if;

  begin
    perform public.erp_billing_command(gen_random_uuid(), 900002, jsonb_build_object(
      'action','save_line','billing_id',exception_id,'po_item_id',982001,
      'pieces','[{"size_id":982001,"pieces":3,"price":40}]'::jsonb));
    raise exception 'TEST: exceeded PO allowance';
  exception when raise_exception then
    if sqlerrm <> 'Insufficient physical stock or PO allowance' then raise; end if;
  end;
  begin
    perform public.erp_billing_command(gen_random_uuid(), 900002, jsonb_build_object(
      'action','save_line','billing_id',exception_id,'po_item_id',982002,
      'pieces','[{"size_id":982001,"pieces":7,"price":40}]'::jsonb));
    raise exception 'TEST: exceeded physical stock';
  exception when raise_exception then
    if sqlerrm <> 'Insufficient physical stock or PO allowance' then raise; end if;
  end;
  perform public.erp_billing_command(gen_random_uuid(), 900002, jsonb_build_object(
    'action','save_line','billing_id',exception_id,'po_item_id',982001,
    'pieces','[{"size_id":982001,"pieces":2,"price":40}]'::jsonb));
  select id into strict exception_line from garments_erp.billing_item where billing_id = exception_id;
  select id into strict exception_component from garments_erp.billing_item_piece_per_size where billing_item_id = exception_line;
  perform public.erp_billing_command(gen_random_uuid(), 900002,
    jsonb_build_object('action','finalize','billing_id',standard_id));
  if (select available from garments_access.finished_balances(982001)) <> 4 then
    raise exception 'TEST: finalization changed availability';
  end if;
  perform public.erp_billing_command(gen_random_uuid(), 900002,
    jsonb_build_object('action','finalize','billing_id',exception_id));

  perform public.erp_billing_command(gen_random_uuid(),900002,line || '{"sets":1}'::jsonb);
  if (select available from garments_access.finished_balances(982001)) <> 6
    or (select remaining from public.erp_billing_po_allowance(982001)) <> 2 then
    raise exception 'TEST: finalized amendment did not apply net quantities';
  end if;
  perform public.erp_billing_command(gen_random_uuid(),900002,line);
  carton_a := public.erp_pack_billing_carton(standard_id,'BILL-STD-LIST','1',
    jsonb_build_array(jsonb_build_object('line_id',standard_line,'sets',1)));
  carton_c := public.erp_pack_billing_carton(exception_id,'BILL-EX-LIST','1',
    jsonb_build_array(jsonb_build_object('line_id',exception_line,'pieces',
      jsonb_build_array(jsonb_build_object('billed_piece_id',exception_component,'pieces',2)))));
  insert into garments_erp.transport (transporter_id, transport_status_type_id)
  select 982001,id from garments_erp.transport_status_type where type = 'draft' returning id into transport_a;
  insert into garments_erp.transport_item (transport_id, carton_id)
  values (transport_a, carton_a), (transport_a, carton_c);
  begin
    perform public.erp_dispatch_transport(transport_a,900002,gen_random_uuid());
    raise exception 'TEST: incomplete invoice dispatched';
  exception when raise_exception then
    if sqlerrm <> 'Carton allocations exceed billed quantities or packing is incomplete' then raise; end if;
  end;
  carton_b := public.erp_pack_billing_carton(standard_id,'BILL-STD-LIST','2',
    jsonb_build_array(jsonb_build_object('line_id',standard_line,'sets',1)));

  begin
    perform public.erp_billing_command(gen_random_uuid(),900002,line || '{"sets":1}'::jsonb);
    raise exception 'TEST: amendment allowed overpacking';
  exception when raise_exception then
    if sqlerrm <> 'Carton allocations exceed billed quantities or packing is incomplete' then raise; end if;
  end;
  request_id := gen_random_uuid();
  perform public.erp_dispatch_transport(transport_a,900002,request_id);
  perform public.erp_dispatch_transport(transport_a,900002,request_id);
  if (select dispatched_at from garments_erp.billing where id = standard_id) is not null
    or (select dispatched_at from garments_erp.billing where id = exception_id) is null then
    raise exception 'TEST: partial transport dispatch states incorrect';
  end if;
  begin
    perform public.erp_billing_command(gen_random_uuid(),900002,line);
    raise exception 'TEST: dispatched carton did not freeze the line';
  exception when raise_exception then
    if sqlerrm <> 'A dispatched carton freezes its billed line' then raise; end if;
  end;
  insert into garments_erp.transport (transporter_id, transport_status_type_id)
  select 982001,id from garments_erp.transport_status_type where type = 'draft' returning id into transport_b;
  begin
    insert into garments_erp.transport_item (transport_id,carton_id) values (transport_b,carton_a);
    raise exception 'TEST: carton assigned to two transports';
  exception when unique_violation then null;
  end;
  insert into garments_erp.transport_item (transport_id,carton_id) values (transport_b,carton_b);
  perform public.erp_dispatch_transport(transport_b,900002,gen_random_uuid());
  if (select dispatched_at from garments_erp.billing where id = standard_id) is null then
    raise exception 'TEST: final transport failed to dispatch invoice';
  end if;
  perform public.erp_verify_billing_return(gen_random_uuid(),standard_id,900002,
    jsonb_build_array(jsonb_build_object('billed_piece_id',component_id,'pieces',1,'price',35)));
  if (select available from garments_access.finished_balances(982001)) <> 5
    or (select remaining from public.erp_billing_po_allowance(982001)) <> 0 then
    raise exception 'TEST: verified return changed incorrect balance';
  end if;
  begin
    perform public.erp_verify_billing_return(gen_random_uuid(),standard_id,900002,
      jsonb_build_array(jsonb_build_object('billed_piece_id',component_id,'pieces',4,'price',35)));
    raise exception 'TEST: cumulative over-return accepted';
  exception when raise_exception then
    if sqlerrm <> 'Cumulative return exceeds dispatched pieces' then raise; end if;
  end;
  begin
    update garments_erp.item_in_store_price set price = 999 where id = 982001;
    raise exception 'TEST: billed price mutated';
  exception when raise_exception then
    if sqlerrm <> 'A billed price version is immutable' then raise; end if;
  end;
  if has_function_privilege('authenticated','public.erp_billing_command(uuid,bigint,jsonb)','execute')
    or has_table_privilege('service_role','garments_erp.billing_item','insert')
    or has_column_privilege('service_role','garments_erp.transport','transport_status_type_id','update') then
    raise exception 'TEST: direct billing mutation bypass exists';
  end if;
end;
$$;
rollback;
