begin;

create or replace function garments_erp.file_target_definition(p_key text) returns jsonb language plpgsql immutable set search_path='' as $$
declare t jsonb;
begin
 select value into t from jsonb_array_elements('[
 {"key":"yarnBill","group":"fabric_bills","resource":"yarn","table":"yarn_bill","slot":"bill_attachment","label":"invoice_number"},
 {"key":"knittingBill","group":"fabric_bills","resource":"knitting","table":"knitting_bill","slot":"bill_attachment","label":"invoice_number"},
 {"key":"dyedBill","group":"fabric_bills","resource":"dyeBills","table":"dyed_fabric_bill","slot":"bill_attachment","label":"invoice_number"},
 {"key":"workerBill","group":"job_worker_bills","resource":"jobWorkerBills","table":"job_worker_bill","slot":"bill_attachment","label":"id"},
 {"key":"itemImage","group":"items","resource":"productionItems","table":"item","slot":"image_attachment","label":"style_code"},
 {"key":"rawMaterialBill","group":"raw_material_bills","resource":"materialReceipts","table":"raw_material_check_in","slot":"bill_attachment","label":"sku"},
 {"key":"employeePhoto","group":"employee","resource":"employees","table":"employee","slot":"employee_photo","label":"employee_code"},
 {"key":"employeeDocument1","group":"employee","resource":"employees","table":"employee","slot":"supporting_document_1_upload","label":"employee_code"},
 {"key":"employeeDocument2","group":"employee","resource":"employees","table":"employee","slot":"supporting_document_2_upload","label":"employee_code"},
 {"key":"labDipShade","group":"items","resource":"labDips","table":"lab_dip_version","slot":"shade_card_image_attachment","label":"id"},
 {"key":"buyerPO","group":"fabric_bills","resource":"billingBuyerPO","table":"buyer_po","slot":"po_attachment","label":"po_number"},
 {"key":"contactBankDocument","group":"employee","resource":"contactBankAccounts","table":"contact_bank_account","slot":"supporting_documents","label":"name"},
 {"key":"returnBill","group":"fabric_bills","resource":"billingReturns","table":"return_bill","slot":"bill_attachment","label":"id"},
 {"key":"transportBill","group":"fabric_bills","resource":"billingDispatch","table":"transport_bill","slot":"bill_attachment","label":"invoice_number"},
 {"key":"transportDocket","group":"fabric_bills","resource":"billingDispatch","table":"transport_docket","slot":"docket_attachment","label":"docket_number"}
 ]'::jsonb) where value->>'key'=p_key;
 if t is null then raise exception 'Attachment field is not configured';end if;return t;
end $$;

insert into garments_erp.app_file_route(target_key,bucket_group_id,allowed_mime_types,max_bytes)
select route.key,g.id,array['application/pdf','image/jpeg','image/png','image/webp'],10485760
from unnest(array['buyerPO','contactBankDocument','returnBill','transportBill','transportDocket']) route(key)
join garments_erp.bucket_group g on g."group"=garments_erp.file_target_definition(route.key)->>'group';

alter table garments_erp.app_file_upload add column content_sha256 text
  check (content_sha256 ~ '^[a-f0-9]{64}$'),
  add column detached_at timestamptz;

-- Billing file access follows the active employee rule used by Billing commands.
create or replace function garments_erp.file_record(p_key text,p_id bigint,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t jsonb; row_data jsonb;
begin
  t:=garments_erp.file_target(p_key);
  if not garments_access.has_screen_permission(t->>'resource',p_action)
    and not coalesce(p_key='employeePhoto' and p_action in ('view','edit')
      and p_id=garments_access.profile_employee_id(),false)
    and not (p_key='itemImage' and p_action='view'
      and garments_access.has_screen_permission('productionJobs','view')
      and exists(select 1 from garments_erp.production p
        join garments_erp.item_part ip on ip.id=p.item_part_id where ip.item_id=p_id))
  then
    raise exception 'No permission for this attachment' using errcode='42501';
  end if;
  if t->>'resource' in ('billingBuyerPO','billingReturns','billingDispatch') then
    perform garments_erp.billing_employee(t->>'resource');
  end if;
  execute format('select to_jsonb(r) from garments_erp.%I r where id=$1',t->>'table')
    into row_data using p_id;
  if row_data is null then raise exception 'Save the record before attaching a file';end if;
  return t||jsonb_build_object('current',row_data->(t->>'slot'));
end $$;

create or replace function garments_erp.file_records(p_key text,p_query text default '')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t jsonb; result jsonb;
begin
  t:=garments_erp.file_target(p_key);
  if not garments_access.has_screen_permission(t->>'resource','view') then
    raise exception 'No permission for these records' using errcode='42501';
  end if;
  if t->>'resource' in ('billingBuyerPO','billingReturns','billingDispatch') then
    perform garments_erp.billing_employee(t->>'resource');
  end if;
  execute format(
    'select coalesce(jsonb_agg(x),''[]''::jsonb) from (
      select id::text as id,coalesce(%1$I::text,id::text) as label from garments_erp.%2$I
      where coalesce(%1$I::text,id::text) ilike $1 or id::text ilike $1 order by id desc limit 50
    ) x',t->>'label',t->>'table')
    into result using '%'||left(coalesce(p_query,''),100)||'%';
  return result;
end $$;

-- The reviewed request binds the file bytes, target, and previous link. Retrying
-- the same request reuses the immutable object key, including after a lost reply.
create function garments_erp.stage_file_upload(
  p_request uuid,p_key text,p_record_id bigint,p_previous bigint,p_filename text,
  p_mime text,p_size bigint,p_digest text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare reservation garments_erp.app_file_upload; ticket jsonb;
begin
  if p_request is null or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'A reviewed upload request is required';
  end if;
  perform garments_erp.file_record(p_key,p_record_id,'edit');
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,75));
  select * into reservation from garments_erp.app_file_upload where id=p_request for update;
  if found then
    if reservation.created_by is distinct from auth.uid()
       or (reservation.target_key,reservation.record_id,reservation.previous_attachment_id,
           reservation.filename,reservation.mime_type,reservation.byte_size,reservation.content_sha256)
          is distinct from (p_key,p_record_id,p_previous,p_filename,p_mime,p_size,p_digest) then
      raise exception 'Upload request does not match the reviewed file';
    end if;
    if reservation.status<>'ready' and
       (reservation.status<>'pending' or reservation.expires_at<=now()) then
      raise exception 'Upload expired. Return to editing and review the file again.';
    end if;
  else
    ticket:=garments_erp.begin_file_upload(p_key,p_record_id,p_filename,p_mime,p_size);
    if (ticket->>'previous_attachment_id')::bigint is distinct from p_previous then
      raise exception 'Attachment changed. Return to editing and review again.' using errcode='40001';
    end if;
    update garments_erp.app_file_upload set id=p_request,content_sha256=p_digest
      where id=(ticket->>'id')::uuid returning * into reservation;
  end if;
  return jsonb_build_object('id',reservation.id,'status',reservation.status,
    'bucket_id',reservation.bucket_id,'storage_path',reservation.storage_path);
end $$;

create or replace function garments_erp.finish_file_upload(p_ticket uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r garments_erp.app_file_upload;t jsonb;a garments_erp.attachments;current_id bigint; target_rows bigint; o storage.objects;
begin
 select * into strict r from garments_erp.app_file_upload where id=p_ticket and created_by=auth.uid() for update;
 t:=garments_erp.file_record(r.target_key,r.record_id,'edit');
 if r.status='ready' then select * into a from garments_erp.attachments where id=r.attachment_id;return to_jsonb(a)||jsonb_build_object('id',a.id::text);end if;
 if r.status<>'pending' or r.expires_at<now() then raise exception 'Upload expired or cancelled';end if;
 execute format('select %I from garments_erp.%I where id=$1 for update',t->>'slot',t->>'table') into current_id using r.record_id;
 get diagnostics target_rows = row_count;
 if target_rows<>1 then raise exception 'Attachment record no longer exists' using errcode='40001';end if;
 if current_id is distinct from r.previous_attachment_id then raise exception 'Attachment changed. Reload before retrying' using errcode='40001';end if;
 select * into strict o from storage.objects where bucket_id=r.bucket_id and name=r.storage_path;
 if (o.metadata->>'size')::bigint is distinct from r.byte_size or o.metadata->>'mimetype' is distinct from r.mime_type then raise exception 'Uploaded object does not match reservation';end if;
 insert into garments_erp.attachments(bucket_group_id,storage_path,filename,mime_type,file_size,uploaded_by) values(r.bucket_group_id,r.storage_path,r.filename,r.mime_type,r.byte_size::text,r.employee_id) returning * into a;
 execute format('update garments_erp.%I set %I=$1 where id=$2',t->>'table',t->>'slot') using a.id,r.record_id;
 update garments_erp.app_file_upload set status='ready',attachment_id=a.id where id=r.id;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'Attached file',t->>'table',r.record_id::text,jsonb_build_object('attachment_id',a.id::text,'group',t->>'group'));
 return to_jsonb(a)||jsonb_build_object('id',a.id::text);
end $$;

create function garments_erp.remove_file_link(p_key text,p_record_id bigint,p_previous bigint)
returns void language plpgsql security definer set search_path='' as $$
declare t jsonb; current_id bigint;
begin
  t:=garments_erp.file_record(p_key,p_record_id,'edit');
  if p_previous is null then raise exception 'Choose the current file to remove';end if;
  execute format('select %I from garments_erp.%I where id=$1 for update',t->>'slot',t->>'table')
    into current_id using p_record_id;
  if current_id is null then return;end if;
  if current_id is distinct from p_previous then
    raise exception 'Attachment changed. Return to editing and review again.' using errcode='40001';
  end if;
  execute format('update garments_erp.%I set %I=null where id=$1',t->>'table',t->>'slot')
    using p_record_id;
  update garments_erp.app_file_upload set detached_at=now()
    where target_key=p_key and record_id=p_record_id and attachment_id=p_previous;
  insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details)
  values(auth.uid(),'Removed file link',t->>'table',p_record_id::text,
    jsonb_build_object('attachment_id',p_previous::text,'slot',t->>'slot'));
end $$;

-- A scoped read supports pre-existing attachments and verifies the current link.
-- Unlinked and replaced objects remain in private Storage for retention.
create function garments_erp.read_linked_file(p_key text,p_record_id bigint,p_id bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t jsonb; result jsonb;
begin
  t:=garments_erp.file_record(p_key,p_record_id,'view');
  if p_id is null or (t->>'current')::bigint is distinct from p_id then
    raise exception 'File is no longer attached to this record' using errcode='42501';
  end if;
  select jsonb_build_object('bucket_id',g.bucket_id,'storage_path',a.storage_path)
    into strict result
    from garments_erp.attachments a
    join garments_erp.bucket_group g on g.id=a.bucket_group_id
    join storage.buckets b on b.id=g.bucket_id and not b.public
    where a.id=p_id and a.storage_path is not null;
  return result;
end $$;

create or replace function garments_erp.file_read(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare upload garments_erp.app_file_upload; result jsonb;
begin
  select * into upload from garments_erp.app_file_upload where attachment_id=p_id and status='ready';
  if not found then raise exception 'Attachment is not registered to a record';end if;
  if upload.detached_at is not null then raise exception 'File was removed' using errcode='42501';end if;
  perform garments_erp.file_record(upload.target_key,upload.record_id,'view');
  select jsonb_build_object('bucket_id',g.bucket_id,'storage_path',a.storage_path)
    into strict result
    from garments_erp.attachments a
    join garments_erp.bucket_group g on g.id=a.bucket_group_id
    join storage.buckets b on b.id=g.bucket_id and not b.public
    where a.id=p_id and a.storage_path is not null;
  return result;
end $$;

create or replace function garments_erp.file_cleanup(p_ticket uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_ticket is null then
  perform garments_access.require_administrator();
  update garments_erp.app_file_upload set status='cleanup_required' where (status='pending' and expires_at<now())
     or (status='cancelled' and exists (
       select 1 from storage.objects o
       where o.bucket_id=app_file_upload.bucket_id and o.name=app_file_upload.storage_path
     ));
  return (select coalesce(jsonb_agg(to_jsonb(u)),'[]'::jsonb) from (select id,bucket_id,storage_path from garments_erp.app_file_upload where status='cleanup_required' order by created_at limit 50) u);
 end if;
 if not exists(select 1 from garments_erp.app_file_upload where id=p_ticket and status='cleanup_required' and (created_by=auth.uid() or garments_access.has_screen_permission('adminRoles','view'))) then raise exception 'Cleanup not allowed' using errcode='42501';end if;
 return (select to_jsonb(u) from garments_erp.app_file_upload u where id=p_ticket);
end $$;

create function public.erp_stage_file_upload(
  p_request uuid,p_key text,p_record_id bigint,p_previous bigint,p_filename text,
  p_mime text,p_size bigint,p_digest text
) returns jsonb language sql security invoker set search_path='' as $$
  select garments_erp.stage_file_upload(p_request,p_key,p_record_id,p_previous,p_filename,p_mime,p_size,p_digest);
$$;
create function public.erp_remove_file_link(p_key text,p_record_id bigint,p_previous bigint)
returns void language sql security invoker set search_path='' as $$
  select garments_erp.remove_file_link(p_key,p_record_id,p_previous);
$$;
create function public.erp_read_linked_file(p_key text,p_record_id bigint,p_id bigint)
returns jsonb language sql security invoker set search_path='' as $$
  select garments_erp.read_linked_file(p_key,p_record_id,p_id);
$$;

revoke all on function
  public.erp_stage_file_upload(uuid,text,bigint,bigint,text,text,bigint,text),
  garments_erp.stage_file_upload(uuid,text,bigint,bigint,text,text,bigint,text),
  public.erp_remove_file_link(text,bigint,bigint),garments_erp.remove_file_link(text,bigint,bigint),
  public.erp_read_linked_file(text,bigint,bigint),garments_erp.read_linked_file(text,bigint,bigint)
  from public,anon;
grant execute on function
  public.erp_stage_file_upload(uuid,text,bigint,bigint,text,text,bigint,text),
  garments_erp.stage_file_upload(uuid,text,bigint,bigint,text,text,bigint,text),
  public.erp_remove_file_link(text,bigint,bigint),garments_erp.remove_file_link(text,bigint,bigint),
  public.erp_read_linked_file(text,bigint,bigint),garments_erp.read_linked_file(text,bigint,bigint)
  to authenticated;

notify pgrst, 'reload schema';

commit;
