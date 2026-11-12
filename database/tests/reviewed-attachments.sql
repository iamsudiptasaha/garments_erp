begin;

select set_config('request.jwt.claim.sub',(
  select u.user_id::text from garments_access.app_user u
  join garments_access.app_user_role ur on ur.user_id=u.user_id
  join garments_access.app_role r on r.id=ur.role_id
  where u.is_active and r.is_system_admin limit 1
),true);

do $$
declare
  expected record;
  document_id bigint;
  first_id bigint;
  second_id bigint;
  first_request uuid:=gen_random_uuid();
  second_request uuid:=gen_random_uuid();
  stale_request uuid:=gen_random_uuid();
  expired_request uuid:=gen_random_uuid();
  ticket jsonb;
  expired jsonb;
  digest text:=repeat('a',64);
begin
  for expected in select * from (values
    ('buyerPO','buyer_po','po_attachment','billingBuyerPO'),
    ('contactBankDocument','contact_bank_account','supporting_documents','contactBankAccounts'),
    ('returnBill','return_bill','bill_attachment','billingReturns'),
    ('transportBill','transport_bill','bill_attachment','billingDispatch'),
    ('transportDocket','transport_docket','docket_attachment','billingDispatch')
  ) routes(key_name,table_name,slot_name,resource_name) loop
    ticket:=garments_erp.file_target(expected.key_name);
    if (ticket->>'table',ticket->>'slot',ticket->>'resource') is distinct from
       (expected.table_name,expected.slot_name,expected.resource_name)
       or not exists (
         select 1 from garments_erp.bucket_group g
         join storage.buckets b on b.id=g.bucket_id and not b.public
         where g.id=(ticket->>'bucket_group_id')::bigint
       ) then
      raise exception 'Invalid file route %',expected.key_name;
    end if;
  end loop;

  insert into garments_erp.transport_bill(invoice_number) values('FILE-FIXTURE') returning id into document_id;
  ticket:=public.erp_stage_file_upload(first_request,'transportBill',document_id,null,
    'proof.pdf','application/pdf',9,digest);
  if ticket is distinct from public.erp_stage_file_upload(first_request,'transportBill',document_id,null,
    'proof.pdf','application/pdf',9,digest) then raise exception 'Retry changed the reservation';end if;
  begin
    perform public.erp_stage_file_upload(first_request,'transportBill',document_id,null,
      'proof.pdf','application/pdf',9,repeat('b',64));
    raise exception 'Different bytes accepted';
  exception when raise_exception then
    if sqlerrm<>'Upload request does not match the reviewed file' then raise;end if;
  end;
  begin
    perform public.erp_finish_file_upload(first_request);
    raise exception 'Missing object accepted';
  exception when no_data_found then null;
  end;
  if exists(select 1 from garments_erp.transport_bill where id=document_id and bill_attachment is not null)
    then raise exception 'Staging changed the record';end if;

  insert into storage.objects(bucket_id,name,metadata)
  values(ticket->>'bucket_id',ticket->>'storage_path','{"size":9,"mimetype":"application/pdf"}');
  first_id:=(public.erp_finish_file_upload(first_request)->>'id')::bigint;
  if (public.erp_finish_file_upload(first_request)->>'id')::bigint is distinct from first_id
     or public.erp_read_linked_file('transportBill',document_id,first_id)->>'storage_path'
        is distinct from ticket->>'storage_path' then raise exception 'Finalization or scoped read failed';end if;

  ticket:=public.erp_stage_file_upload(second_request,'transportBill',document_id,first_id,
    'replace.pdf','application/pdf',9,digest);
  perform public.erp_stage_file_upload(stale_request,'transportBill',document_id,first_id,
    'stale.pdf','application/pdf',9,digest);
  insert into storage.objects(bucket_id,name,metadata)
  values(ticket->>'bucket_id',ticket->>'storage_path','{"size":9,"mimetype":"application/pdf"}');
  second_id:=(public.erp_finish_file_upload(second_request)->>'id')::bigint;
  begin
    perform public.erp_finish_file_upload(stale_request);
    raise exception 'Concurrent replacement accepted';
  exception when serialization_failure then null;
  end;
  begin
    perform public.erp_remove_file_link('transportBill',document_id,first_id);
    raise exception 'Stale removal accepted';
  exception when serialization_failure then null;
  end;

  expired:=public.erp_stage_file_upload(expired_request,'transportBill',document_id,second_id,
    'orphan.pdf','application/pdf',9,digest);
  update garments_erp.app_file_upload set expires_at=now()-interval '1 minute' where id=expired_request;
  perform public.erp_file_cleanup();
  if public.erp_file_cleanup(expired_request)->>'status'<>'cleanup_required'
    then raise exception 'Expired upload did not enter cleanup';end if;
  perform public.erp_file_cleanup_done(expired_request);
  insert into storage.objects(bucket_id,name,metadata)
  values(expired->>'bucket_id',expired->>'storage_path','{"size":9,"mimetype":"application/pdf"}');
  perform public.erp_file_cleanup();
  if public.erp_file_cleanup(expired_request)->>'status'<>'cleanup_required'
    then raise exception 'Late orphan did not re-enter cleanup';end if;

  perform public.erp_remove_file_link('transportBill',document_id,second_id);
  perform public.erp_remove_file_link('transportBill',document_id,second_id);
  begin
    perform public.erp_file_read(second_id);
    raise exception 'Detached object still readable through the unscoped RPC';
  exception when insufficient_privilege then null;
  end;
  if not exists (select 1 from garments_access.app_activity_log
    where target_type='transport_bill' and target_id=document_id::text and action='Removed file link')
    then raise exception 'Removal audit missing';end if;

  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
  begin
    perform public.erp_remove_file_link('transportBill',document_id,second_id);
    raise exception 'Unauthorized removal accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.erp_stage_file_upload(gen_random_uuid(),'transportBill',document_id,null,
      'forbidden.pdf','application/pdf',9,digest);
    raise exception 'Unauthorized staging accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
