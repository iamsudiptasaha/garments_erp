begin;
create function garments_access.file_target_definition(p_key text) returns jsonb language plpgsql immutable set search_path='' as $$
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
 {"key":"employeeDocument2","group":"employee","resource":"employees","table":"employee","slot":"supporting_document_2_upload","label":"employee_code"},
 {"key":"labDipShade","group":"items","resource":"labDips","table":"lab_dip_version","slot":"shade_card_image_attachment","label":"id"}
 ]'::jsonb) where value->>'key'=p_key;
 if t is null then raise exception 'Attachment field is not configured';end if;return t;
end $$;

create table garments_access.app_file_route(
 target_key text primary key,
 bucket_group_id bigint not null references garments_erp.bucket_group(id) on delete restrict,
 allowed_mime_types text[] not null,
 max_bytes bigint not null check(max_bytes>0 and max_bytes<=10485760),
 is_active boolean not null default true,
 version bigint not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz,
 check(cardinality(allowed_mime_types)>0 and allowed_mime_types<@array['application/pdf','image/jpeg','image/png','image/webp']::text[])
);
create index app_file_route_group_idx on garments_access.app_file_route(bucket_group_id);
alter table garments_access.app_file_route enable row level security;
revoke all on garments_access.app_file_route from public,anon,authenticated;
create trigger zz_stamp_updated_at before insert or update on garments_access.app_file_route for each row execute function garments_access.stamp_updated_at();
insert into garments_access.app_file_route(target_key,bucket_group_id,allowed_mime_types,max_bytes)
select k,g.id,case when k in ('itemImage','labDipShade') then array['image/jpeg','image/png','image/webp'] else array['application/pdf','image/jpeg','image/png','image/webp'] end,10485760
from unnest(array['yarnBill','knittingBill','dyedBill','workerBill','itemImage','rawMaterialBill','employeeDocument1','employeeDocument2','labDipShade']) k
join garments_erp.bucket_group g on g."group"=garments_access.file_target_definition(k)->>'group';
create or replace function garments_access.file_target(p_key text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t jsonb;r garments_access.app_file_route;g garments_erp.bucket_group;
begin
 t:=garments_access.file_target_definition(p_key);
 select * into r from garments_access.app_file_route where target_key=p_key;
 if not found then raise exception 'Attachment route is not configured';end if;
 select * into strict g from garments_erp.bucket_group where id=r.bucket_group_id;
 return t||jsonb_build_object('group',g."group",'bucket_group_id',g.id::text,'mime',r.allowed_mime_types,'max_bytes',r.max_bytes,'enabled',r.is_active,'version',r.version);
end $$;
create function garments_access.file_routes() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from garments_access.app_user where user_id=auth.uid() and is_active) then raise exception 'Enabled account required' using errcode='42501';end if;
 select coalesce(jsonb_agg(garments_access.file_target(r.target_key) order by r.target_key),'[]'::jsonb) into result
 from garments_access.app_file_route r where garments_access.has_screen_permission(garments_access.file_target_definition(r.target_key)->>'resource','view') or garments_access.has_screen_permission('adminRoles','view');
 return result;
end $$;
create function garments_access.save_file_route(p_key text,p_group_id bigint,p_mimes text[],p_max_bytes bigint,p_enabled boolean,p_version bigint) returns void language plpgsql security definer set search_path='' as $$
declare r garments_access.app_file_route;t jsonb;g garments_erp.bucket_group;b storage.buckets;
begin
 perform garments_access.require_administrator();
 t:=garments_access.file_target_definition(p_key);
 select * into strict r from garments_access.app_file_route where target_key=p_key for update;
 if r.version is distinct from p_version then raise exception 'Route changed. Reload before saving' using errcode='40001';end if;
 select * into strict g from garments_erp.bucket_group where id=p_group_id;
 select * into strict b from storage.buckets where id=g.bucket_id;
 if b.public then raise exception 'Choose a private bucket group';end if;
 if p_mimes is null or cardinality(p_mimes)=0 or array_position(p_mimes,null) is not null or not(p_mimes<@array['application/pdf','image/jpeg','image/png','image/webp']::text[]) then raise exception 'Choose supported file types';end if;
 if p_key in ('itemImage','labDipShade') and 'application/pdf'=any(p_mimes) then raise exception 'This image attachment requires image types';end if;
 if p_max_bytes is null or p_max_bytes<=0 or p_max_bytes>least(coalesce(b.file_size_limit,10485760),10485760) or p_enabled is null then raise exception 'File limit exceeds the destination bucket limit';end if;
 if exists(select 1 from garments_access.app_file_upload where target_key=p_key and status='pending' and expires_at>now()) then raise exception 'An upload is in progress. Retry after it finishes';end if;
 update garments_access.app_file_route set bucket_group_id=p_group_id,allowed_mime_types=p_mimes,max_bytes=p_max_bytes,is_active=p_enabled,version=version+1 where target_key=p_key;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'Updated upload route','file_route',p_key,jsonb_build_object('bucket_group_id',p_group_id::text,'mime_types',p_mimes,'max_bytes',p_max_bytes,'enabled',p_enabled));
end $$;
create or replace function garments_access.begin_file_upload(p_key text,p_record_id bigint,p_filename text,p_mime text,p_size bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare t jsonb; g garments_erp.bucket_group; b storage.buckets; r garments_access.app_file_upload; eid bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,74));
 perform 1 from garments_access.app_file_route where target_key=p_key for update;
 t:=garments_access.file_record(p_key,p_record_id,'edit');
 if not (t->>'enabled')::boolean then raise exception 'Uploads are disabled for this field';end if;
 select employee_id into eid from garments_access.app_user where user_id=auth.uid() and is_active;
 if eid is null then raise exception 'Linked employee required';end if;
 if (select count(*) from garments_access.app_file_upload where created_by=auth.uid() and status='pending' and expires_at>now())>=5 then raise exception 'Finish pending uploads before adding more';end if;
 select * into strict g from garments_erp.bucket_group where "group"=t->>'group' for update;
 select * into strict b from storage.buckets where id=g.bucket_id;
 if b.public then raise exception 'Private bucket required';end if;
 if p_filename is null or length(trim(p_filename))=0 or length(p_filename)>240 or p_filename~'[[:cntrl:]]' then raise exception 'Invalid filename';end if;
 if p_size is null or p_size<=0 or p_size>least(coalesce(b.file_size_limit,10485760),(t->>'max_bytes')::bigint,10485760) then raise exception 'File exceeds upload limit';end if;
 if p_mime is null or not ((t->'mime') ? p_mime) then raise exception 'Unsupported file type';end if;
 insert into garments_access.app_file_upload(target_key,record_id,bucket_group_id,bucket_id,storage_path,previous_attachment_id,filename,mime_type,byte_size,created_by,employee_id)
 values(p_key,p_record_id,g.id,g.bucket_id,concat(t->>'table','/',p_record_id,'/',t->>'slot','/',gen_random_uuid()),(t->>'current')::bigint,p_filename,p_mime,p_size,auth.uid(),eid) returning * into r;
 return to_jsonb(r)||jsonb_build_object('id',r.id::text,'bucket_group_id',r.bucket_group_id::text);
end $$;
create function public.erp_file_routes() returns jsonb language sql security invoker set search_path='' as $f$ select garments_access.file_routes(); $f$;
revoke all on function public.erp_file_routes(),garments_access.file_routes() from public,anon;
grant execute on function public.erp_file_routes(),garments_access.file_routes() to authenticated;
create function public.erp_save_file_route(p_key text,p_group_id bigint,p_mimes text[],p_max_bytes bigint,p_enabled boolean,p_version bigint) returns void language sql security invoker set search_path='' as $f$ select garments_access.save_file_route(p_key,p_group_id,p_mimes,p_max_bytes,p_enabled,p_version); $f$;
revoke all on function public.erp_save_file_route(text,bigint,text[],bigint,boolean,bigint),garments_access.save_file_route(text,bigint,text[],bigint,boolean,bigint) from public,anon;
grant execute on function public.erp_save_file_route(text,bigint,text[],bigint,boolean,bigint),garments_access.save_file_route(text,bigint,text[],bigint,boolean,bigint) to authenticated;
revoke all on function garments_access.file_target_definition(text) from public,anon,authenticated;
commit;
