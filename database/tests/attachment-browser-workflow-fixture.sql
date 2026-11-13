-- Prerequisites for attachment editors. The browser creates the target documents.
insert into garments_erp.transporter(id,contacts_id,contact_purpose_id)
values (982001,900002,900001);
insert into garments_erp.transport_bill(invoice_number,invoice_date)
values ('Existing attachment transport bill',current_date);

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000001"}',false);

select public.erp_save_challan_document(false,'create',
 '{"lines":[{"assignment":"974001","rate":"12","quantities":{"Test S":"24","Test M":"8"}}]}');

insert into garments_erp.buyer_po(id,po_number,buyer_list_id,po_source_type_id)
select 982001,'Attachment billing prerequisites',982001,id from garments_erp.po_source_type where type='formal';
insert into garments_erp.po_item(id,buyer_po_id,sale_mode_type_id)
select 982001,982001,id from garments_erp.sale_mode_type where type='exception';
insert into garments_erp.po_item_piece_per_size(po_item_id,item_size_list_id,pieces_ordered)
values (982001,982001,6);

do $$
declare
  invoice_name text;
  invoice_id bigint;
  line_id bigint;
  piece_id bigint;
  carton_id bigint;
  transport_id bigint;
begin
  foreach invoice_name in array array['Attachment dispatch','Attachment return'] loop
    invoice_id := public.erp_billing_command(gen_random_uuid(),900002,jsonb_build_object(
      'action','create','formal_po_id',982001,'mode','exception','invoice_number',invoice_name,'gst_percentage',5));
    perform public.erp_billing_command(gen_random_uuid(),900002,jsonb_build_object(
      'action','save_line','billing_id',invoice_id,'po_item_id',982001,
      'pieces','[{"size_id":982001,"pieces":2,"price":40}]'::jsonb));
    perform public.erp_billing_command(gen_random_uuid(),900002,jsonb_build_object(
      'action','finalize','billing_id',invoice_id));
    select id into strict line_id from garments_erp.billing_item where billing_id=invoice_id;
    select id into strict piece_id from garments_erp.billing_item_piece_per_size where billing_item_id=line_id;
    carton_id := public.erp_pack_billing_carton(invoice_id,invoice_name,'1',jsonb_build_array(
      jsonb_build_object('line_id',line_id,'pieces',jsonb_build_array(
        jsonb_build_object('billed_piece_id',piece_id,'pieces',2)))));
    if invoice_name='Attachment return' then
      transport_id := public.erp_portal_create_transport(gen_random_uuid(),982001,
        'Attachment return source',current_date,array[carton_id])::bigint;
      perform public.erp_dispatch_transport(transport_id,900002,gen_random_uuid());
    end if;
  end loop;
end $$;
