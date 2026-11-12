begin;
-- Five private buckets only. Registry IDs remain stable.
do $$
declare d record; b text;
begin
 for d in select * from (values
 ('job_worker_bills','garments-job-worker-bills','Bills from job workers'),
 ('fabric_bills','garments-fabric-bills','Yarn, knitting and dyeing bills'),
 ('items','garments-items','Item-related files except job worker bills'),
 ('raw_material_bills','garments-raw-material-bills','Raw material receipt bills'),
 ('employee','garments-employee','Employee supporting documents')) as x(g,b,description) loop
 select bucket_id into b from garments_erp.bucket_group where "group"=d.g;
 b:=coalesce(b,d.b);
 if exists(select 1 from storage.buckets where id=b and public) then raise exception 'Registered bucket is public';end if;
 insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values(b,b,false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
 insert into garments_erp.bucket_group("group",bucket_id,description) values(d.g,b,d.description) on conflict("group") do update set bucket_id=coalesce(garments_erp.bucket_group.bucket_id,excluded.bucket_id);
 end loop;
end $$;
alter table garments_erp.bucket_group add column version bigint not null default 1 check(version>0);
create unique index bucket_group_one_bucket_idx on garments_erp.bucket_group(bucket_id) where bucket_id is not null;
create unique index attachments_group_path_idx on garments_erp.attachments(bucket_group_id,storage_path) where bucket_group_id is not null and storage_path is not null;
create table garments_access.app_file_upload(
 id uuid primary key default gen_random_uuid(),
 target_key text not null,record_id bigint not null check(record_id>0),
 bucket_group_id bigint not null references garments_erp.bucket_group(id),
 bucket_id text not null references storage.buckets(id),storage_path text not null,
 previous_attachment_id bigint references garments_erp.attachments(id),
 attachment_id bigint unique references garments_erp.attachments(id),
 filename text not null,mime_type text not null,byte_size bigint not null check(byte_size>0 and byte_size<=10485760),
 created_by uuid not null references auth.users(id),employee_id bigint not null references garments_erp.employee(id),
 status text not null default 'pending' check(status in ('pending','ready','cleanup_required','cancelled')),
 created_at timestamptz not null default now(),updated_at timestamptz,
 expires_at timestamptz not null default now()+interval '15 minutes',
 unique(bucket_id,storage_path),check((status='ready')=(attachment_id is not null))
);
create index app_file_upload_actor on garments_access.app_file_upload(created_by);
create index app_file_upload_record on garments_access.app_file_upload(target_key,record_id);
create index app_file_upload_group on garments_access.app_file_upload(bucket_group_id);
create index app_file_upload_employee on garments_access.app_file_upload(employee_id);
create index app_file_upload_previous on garments_access.app_file_upload(previous_attachment_id);
alter table garments_access.app_file_upload enable row level security;
revoke all on garments_access.app_file_upload from public,anon,authenticated;
create trigger zz_stamp_updated_at before insert or update on garments_access.app_file_upload for each row execute function garments_access.stamp_updated_at();

create function garments_access.file_target(p_key text) returns jsonb language plpgsql immutable set search_path='' as $$
declare t jsonb;
begin
 select value into t from jsonb_array_elements('[
 {"key":"yarnBill","group":"fabric_bills","resource":"yarn","table":"yarn_bill","slot":"bill_attachment","label":"invoice_number"},
 {"key":"knittingBill","group":"fabric_bills","resource":"knitting","table":"knitting_bill","slot":"bill_attachment","label":"invoice_number"},
 {"key":"dyedBill","group":"fabric_bills","resource":"dyeBills","table":"dyed_fabric_bill","slot":"bill_attachment","label":"invoice_number"},
 {"key":"workerBill","group":"job_worker_bills","resource":"jobWorkerBills","table":"job_worker_bill","slot":"bill_attachment","label":"id"},
 {"key":"itemImage","group":"items","resource":"productionItems","table":"item","slot":"image_attachment","label":"style_code"},
 {"key":"rawMaterialBill","group":"raw_material_bills","resource":"materialReceipts","table":"raw_material_check_in","slot":"bill_attachment","label":"sku"},
 {"key":"employeeDocument1","group":"employee","resource":"employees","table":"employee","slot":"supporting_document_1_upload","label":"employee_code"},
 {"key":"employeeDocument2","group":"employee","resource":"employees","table":"employee","slot":"supporting_document_2_upload","label":"employee_code"}
 ]'::jsonb) where value->>'key'=p_key;
 if t is null then raise exception 'Attachment field is not configured';end if;return t;
end $$;
create function garments_access.file_record(p_key text,p_id bigint,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare t jsonb; row_data jsonb;
begin
 t:=garments_access.file_target(p_key);
 if not garments_access.has_screen_permission(t->>'resource',p_action) then raise exception 'No permission for this attachment' using errcode='42501';end if;
 execute format('select to_jsonb(r) from garments_erp.%I r where id=$1',t->>'table') into row_data using p_id;
 if row_data is null then raise exception 'Save the record in Supabase before attaching a file';end if;
 return t||jsonb_build_object('current',row_data->(t->>'slot'));
end $$;
create function garments_access.file_registry() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from garments_access.app_user where user_id=auth.uid() and is_active) then raise exception 'Enabled account required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',g.id::text,'group',g."group",'description',g.description,'bucket_id',g.bucket_id,'private',not b.public,'max_bytes',coalesce(b.file_size_limit,10485760),'version',g.version) order by g.id),'[]'::jsonb) from garments_erp.bucket_group g join storage.buckets b on b.id=g.bucket_id);
end $$;
create function garments_access.file_records(p_key text,p_query text default '') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t jsonb; result jsonb;
begin
 t:=garments_access.file_target(p_key);
 if not garments_access.has_screen_permission(t->>'resource','view') then raise exception 'No permission for these records' using errcode='42501';end if;
 execute format('select coalesce(jsonb_agg(x),''[]''::jsonb) from (select id::text as id,coalesce(%I::text,id::text) as label from garments_erp.%I where %I::text ilike $1 order by id desc limit 50) x',t->>'label',t->>'table',t->>'label') into result using '%'||left(coalesce(p_query,''),100)||'%';return result;
end $$;
create function garments_access.begin_file_upload(p_key text,p_record_id bigint,p_filename text,p_mime text,p_size bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare t jsonb; g garments_erp.bucket_group; b storage.buckets; r garments_access.app_file_upload; eid bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,74));
 t:=garments_access.file_record(p_key,p_record_id,'edit');
 select employee_id into eid from garments_access.app_user where user_id=auth.uid() and is_active;
 if eid is null then raise exception 'Linked employee required';end if;
 if (select count(*) from garments_access.app_file_upload where created_by=auth.uid() and status='pending' and expires_at>now())>=5 then raise exception 'Finish pending uploads before adding more';end if;
 select * into strict g from garments_erp.bucket_group where "group"=t->>'group' for update;
 select * into strict b from storage.buckets where id=g.bucket_id;
 if b.public then raise exception 'Private bucket required';end if;
 if p_filename is null or length(trim(p_filename))=0 or length(p_filename)>240 or p_filename~'[[:cntrl:]]' then raise exception 'Invalid filename';end if;
 if p_size is null or p_size<=0 or p_size>least(coalesce(b.file_size_limit,10485760),10485760) then raise exception 'File exceeds upload limit';end if;
 if p_mime is null or p_mime not in ('application/pdf','image/jpeg','image/png','image/webp') or (p_key='itemImage' and p_mime='application/pdf') then raise exception 'Unsupported file type';end if;
 insert into garments_access.app_file_upload(target_key,record_id,bucket_group_id,bucket_id,storage_path,previous_attachment_id,filename,mime_type,byte_size,created_by,employee_id)
 values(p_key,p_record_id,g.id,g.bucket_id,concat(t->>'table','/',p_record_id,'/',t->>'slot','/',gen_random_uuid()),(t->>'current')::bigint,p_filename,p_mime,p_size,auth.uid(),eid) returning * into r;
 return to_jsonb(r)||jsonb_build_object('id',r.id::text,'bucket_group_id',r.bucket_group_id::text);
end $$;
create function garments_access.finish_file_upload(p_ticket uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r garments_access.app_file_upload;t jsonb;a garments_erp.attachments;current_id bigint;o storage.objects;
begin
 select * into strict r from garments_access.app_file_upload where id=p_ticket and created_by=auth.uid() for update;
 t:=garments_access.file_record(r.target_key,r.record_id,'edit');
 if r.status='ready' then select * into a from garments_erp.attachments where id=r.attachment_id;return to_jsonb(a)||jsonb_build_object('id',a.id::text);end if;
 if r.status<>'pending' or r.expires_at<now() then raise exception 'Upload expired or cancelled';end if;
 execute format('select %I from garments_erp.%I where id=$1 for update',t->>'slot',t->>'table') into current_id using r.record_id;
 if current_id is distinct from r.previous_attachment_id then raise exception 'Attachment changed. Reload before retrying' using errcode='40001';end if;
 select * into strict o from storage.objects where bucket_id=r.bucket_id and name=r.storage_path;
 if (o.metadata->>'size')::bigint is distinct from r.byte_size or o.metadata->>'mimetype' is distinct from r.mime_type then raise exception 'Uploaded object does not match reservation';end if;
 insert into garments_erp.attachments(bucket_group_id,storage_path,filename,mime_type,file_size,uploaded_by) values(r.bucket_group_id,r.storage_path,r.filename,r.mime_type,r.byte_size::text,r.employee_id) returning * into a;
 execute format('update garments_erp.%I set %I=$1 where id=$2',t->>'table',t->>'slot') using a.id,r.record_id;
 update garments_access.app_file_upload set status='ready',attachment_id=a.id where id=r.id;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'Attached file',t->>'table',r.record_id::text,jsonb_build_object('attachment_id',a.id::text,'group',t->>'group'));
 return to_jsonb(a)||jsonb_build_object('id',a.id::text);
end $$;
create function garments_access.file_list(p_key text,p_record_id bigint) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t jsonb;
begin
 t:=garments_access.file_record(p_key,p_record_id,'view');
 return (select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('id',a.id::text,'current',a.id=(t->>'current')::bigint) order by a.created_at desc),'[]'::jsonb) from garments_erp.attachments a where a.id=(t->>'current')::bigint or exists(select 1 from garments_access.app_file_upload u where u.target_key=p_key and u.record_id=p_record_id and u.attachment_id=a.id and u.status='ready'));
end $$;
create function garments_access.file_read(p_id bigint) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u garments_access.app_file_upload;t jsonb;a garments_erp.attachments;g garments_erp.bucket_group;
begin
 select * into u from garments_access.app_file_upload where attachment_id=p_id and status='ready';
 if not found then raise exception 'Attachment is not registered to a record';end if;
 t:=garments_access.file_record(u.target_key,u.record_id,'view');
 select * into strict a from garments_erp.attachments where id=p_id;
 select * into strict g from garments_erp.bucket_group where id=a.bucket_group_id;
 if exists(select 1 from storage.buckets where id=g.bucket_id and public) then raise exception 'Private bucket required';end if;
 return jsonb_build_object('bucket_id',g.bucket_id,'storage_path',a.storage_path);
end $$;
create function garments_access.cancel_file_upload(p_ticket uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r garments_access.app_file_upload;
begin
 select * into strict r from garments_access.app_file_upload where id=p_ticket and created_by=auth.uid() for update;
 if r.status='ready' then return jsonb_build_object('ready',true);end if;
 update garments_access.app_file_upload set status='cleanup_required' where id=r.id;
 return to_jsonb(r)||jsonb_build_object('status','cleanup_required');
end $$;
create function garments_access.save_bucket_group(p_group_id bigint,p_version bigint,p_description text,p_max_bytes bigint) returns void language plpgsql security definer set search_path='' as $$
declare g garments_erp.bucket_group;
begin
 perform garments_access.require_administrator();
 if p_description is null or length(trim(p_description))>500 or p_max_bytes not in (1048576,2097152,5242880,10485760) or p_max_bytes is null then raise exception 'Invalid bucket settings';end if;
 select * into strict g from garments_erp.bucket_group where id=p_group_id for update;
 if g.version is distinct from p_version then raise exception 'Settings changed. Reload before saving' using errcode='40001';end if;
 if not exists(select 1 from storage.buckets where id=g.bucket_id and not public) then raise exception 'Private bucket required';end if;
 update garments_erp.bucket_group set description=trim(p_description),version=version+1 where id=g.id;
 update storage.buckets set file_size_limit=p_max_bytes where id=g.bucket_id;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'Updated bucket group','bucket_group',g.id::text,jsonb_build_object('max_bytes',p_max_bytes));
end $$;
-- Named invoker wrappers expose guarded commands only; no table grants or Storage policies.

create function garments_access.file_cleanup(p_ticket uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_ticket is null then
  perform garments_access.require_administrator();
  update garments_access.app_file_upload set status='cleanup_required' where status='pending' and expires_at<now();
  return (select coalesce(jsonb_agg(to_jsonb(u)),'[]'::jsonb) from (select id,bucket_id,storage_path from garments_access.app_file_upload where status='cleanup_required' order by created_at limit 50) u);
 end if;
 if not exists(select 1 from garments_access.app_file_upload where id=p_ticket and status='cleanup_required' and (created_by=auth.uid() or garments_access.has_screen_permission('adminRoles','view'))) then raise exception 'Cleanup not allowed' using errcode='42501';end if;
 return (select to_jsonb(u) from garments_access.app_file_upload u where id=p_ticket);
end $$;
create function garments_access.file_cleanup_done(p_ticket uuid) returns void language plpgsql security definer set search_path='' as $$
declare r garments_access.app_file_upload;
begin
 select * into strict r from garments_access.app_file_upload where id=p_ticket and status='cleanup_required' for update;
 if r.created_by<>auth.uid() and not garments_access.has_screen_permission('adminRoles','view') then raise exception 'Cleanup not allowed' using errcode='42501';end if;
 if exists(select 1 from storage.objects where bucket_id=r.bucket_id and name=r.storage_path) then raise exception 'Object still exists';end if;
 update garments_access.app_file_upload set status='cancelled' where id=r.id;
end $$;
create function public.erp_file_registry() returns jsonb language sql security invoker set search_path='' as $f$ select garments_access.file_registry(); $f$;
revoke all on function garments_access.file_registry(),public.erp_file_registry() from public,anon;
grant execute on function garments_access.file_registry(),public.erp_file_registry() to authenticated;
create function public.erp_file_records(p_key text,p_query text default '') returns jsonb language sql security invoker set search_path='' as $f$ select garments_access.file_records(p_key,p_query); $f$;
revoke all on function garments_access.file_records(text,text),public.erp_file_records(text,text) from public,anon;
grant execute on function garments_access.file_records(text,text),public.erp_file_records(text,text) to authenticated;
create function public.erp_begin_file_upload(p_key text,p_record_id bigint,p_filename text,p_mime text,p_size bigint) returns jsonb language sql security invoker set search_path='' as $f$ select garments_access.begin_file_upload(p_key,p_record_id,p_filename,p_mime,p_size); $f$;
revoke all on function garments_access.begin_file_upload(text,bigint,text,text,bigint),public.erp_begin_file_upload(text,bigint,text,text,bigint) from public,anon;
grant execute on function garments_access.begin_file_upload(text,bigint,text,text,bigint),public.erp_begin_file_upload(text,bigint,text,text,bigint) to authenticated;
create function public.erp_finish_file_upload(p_ticket uuid) returns jsonb language sql security invoker set search_path='' as $f$ select garments_access.finish_file_upload(p_ticket); $f$;
revoke all on function garments_access.finish_file_upload(uuid),public.erp_finish_file_upload(uuid) from public,anon;
grant execute on function garments_access.finish_file_upload(uuid),public.erp_finish_file_upload(uuid) to authenticated;
create function public.erp_file_list(p_key text,p_record_id bigint) returns jsonb language sql security invoker set search_path='' as $f$ select garments_access.file_list(p_key,p_record_id); $f$;
revoke all on function garments_access.file_list(text,bigint),public.erp_file_list(text,bigint) from public,anon;
grant execute on function garments_access.file_list(text,bigint),public.erp_file_list(text,bigint) to authenticated;
create function public.erp_file_read(p_id bigint) returns jsonb language sql security invoker set search_path='' as $f$ select garments_access.file_read(p_id); $f$;
revoke all on function garments_access.file_read(bigint),public.erp_file_read(bigint) from public,anon;
grant execute on function garments_access.file_read(bigint),public.erp_file_read(bigint) to authenticated;
create function public.erp_cancel_file_upload(p_ticket uuid) returns jsonb language sql security invoker set search_path='' as $f$ select garments_access.cancel_file_upload(p_ticket); $f$;
revoke all on function garments_access.cancel_file_upload(uuid),public.erp_cancel_file_upload(uuid) from public,anon;
grant execute on function garments_access.cancel_file_upload(uuid),public.erp_cancel_file_upload(uuid) to authenticated;
create function public.erp_save_bucket_group(p_group_id bigint,p_version bigint,p_description text,p_max_bytes bigint) returns void language sql security invoker set search_path='' as $f$ select garments_access.save_bucket_group(p_group_id,p_version,p_description,p_max_bytes); $f$;
revoke all on function garments_access.save_bucket_group(bigint,bigint,text,bigint),public.erp_save_bucket_group(bigint,bigint,text,bigint) from public,anon;
grant execute on function garments_access.save_bucket_group(bigint,bigint,text,bigint),public.erp_save_bucket_group(bigint,bigint,text,bigint) to authenticated;
create function public.erp_file_cleanup(p_ticket uuid default null) returns jsonb language sql security invoker set search_path='' as $f$ select garments_access.file_cleanup(p_ticket); $f$;
revoke all on function garments_access.file_cleanup(uuid),public.erp_file_cleanup(uuid) from public,anon;
grant execute on function garments_access.file_cleanup(uuid),public.erp_file_cleanup(uuid) to authenticated;
create function public.erp_file_cleanup_done(p_ticket uuid) returns void language sql security invoker set search_path='' as $f$ select garments_access.file_cleanup_done(p_ticket); $f$;
revoke all on function garments_access.file_cleanup_done(uuid),public.erp_file_cleanup_done(uuid) from public,anon;
grant execute on function garments_access.file_cleanup_done(uuid),public.erp_file_cleanup_done(uuid) to authenticated;
revoke all on function garments_access.file_target(text) from public,anon,authenticated;
revoke all on function garments_access.file_record(text,bigint,text) from public,anon,authenticated;
commit;
