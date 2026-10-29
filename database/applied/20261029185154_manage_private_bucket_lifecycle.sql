begin;
alter table garments_erp.bucket_group add column removal_token uuid;
alter table garments_erp.bucket_group add column removal_bucket_id text;
create function garments_access.create_bucket_group(p_group text,p_description text,p_mimes text[],p_max_bytes bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare bid text;gid bigint;
begin
 perform garments_access.require_administrator();
 if p_group is null or p_group!~'^[a-z][a-z0-9_]{1,47}$' then raise exception 'Use 2–48 lowercase letters, numbers or underscores for the group key';end if;
 if p_description is null or length(trim(p_description))>500 then raise exception 'Description must be at most 500 characters';end if;
 if p_max_bytes is null or p_max_bytes not in (1048576,2097152,5242880,10485760) then raise exception 'Choose a file limit up to 10 MB';end if;
 if p_mimes is null or cardinality(p_mimes)=0 or array_position(p_mimes,null) is not null or not(p_mimes<@array['application/pdf','image/jpeg','image/png','image/webp']::text[]) then raise exception 'Choose supported file types';end if;
 if exists(select 1 from garments_erp.bucket_group where "group"=p_group) then raise exception 'That group key already exists';end if;
 bid:='garments-'||replace(p_group,'_','-')||'-'||substr(gen_random_uuid()::text,1,8);
 insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values(bid,bid,false,p_max_bytes,p_mimes);
 insert into garments_erp.bucket_group("group",description,bucket_id) values(p_group,trim(p_description),bid) returning id into gid;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'Created private bucket group','bucket_group',gid::text,jsonb_build_object('group',p_group,'bucket_id',bid,'max_bytes',p_max_bytes,'mime_types',p_mimes));
 return jsonb_build_object('id',gid::text,'bucket_id',bid);
end $$;
create function garments_access.prepare_bucket_removal(p_group_id bigint,p_version bigint,p_confirm text) returns jsonb language plpgsql security definer set search_path='' as $$
declare g garments_erp.bucket_group;bid text;token uuid;
begin
 perform garments_access.require_administrator();
 select * into strict g from garments_erp.bucket_group where id=p_group_id for update;
 if g.version is distinct from p_version then raise exception 'Bucket settings changed. Reload first' using errcode='40001';end if;
 if p_confirm is distinct from g."group" then raise exception 'Type the exact group key to confirm removal';end if;
 bid:=coalesce(g.bucket_id,g.removal_bucket_id);
 if bid is null then raise exception 'Bucket reference is missing';end if;
 if exists(select 1 from garments_access.app_file_route where bucket_group_id=g.id) then raise exception 'Reassign every upload route before removing this bucket';end if;
 if exists(select 1 from garments_erp.attachments where bucket_group_id=g.id) then raise exception 'Attachment references prevent removal';end if;
 if exists(select 1 from garments_access.app_file_upload where bucket_group_id=g.id or bucket_id=bid) then raise exception 'Upload or upload-history references prevent removal';end if;
 if exists(select 1 from storage.objects where bucket_id=bid) then raise exception 'Bucket contains files and cannot be removed';end if;
 token:=coalesce(g.removal_token,gen_random_uuid());
 update garments_erp.bucket_group set removal_token=token,removal_bucket_id=bid where id=g.id;
 return jsonb_build_object('id',g.id::text,'bucket_id',bid,'token',token);
end $$;
create function garments_access.finish_bucket_removal(p_group_id bigint,p_token uuid) returns void language plpgsql security definer set search_path='' as $$
declare g garments_erp.bucket_group;
begin
 perform garments_access.require_administrator();
 select * into strict g from garments_erp.bucket_group where id=p_group_id for update;
 if g.removal_token is null or g.removal_token is distinct from p_token then raise exception 'Removal reservation changed';end if;
 if exists(select 1 from storage.buckets where id=g.removal_bucket_id) then raise exception 'Storage bucket has not been removed';end if;
 -- FK constraints still prevent removal if a reference appears unexpectedly.
 delete from garments_erp.bucket_group where id=g.id;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'Removed empty bucket group','bucket_group',g.id::text,jsonb_build_object('group',g."group",'bucket_id',g.removal_bucket_id));
end $$;
create function garments_access.cancel_bucket_removal(p_group_id bigint,p_token uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform garments_access.require_administrator();
 update garments_erp.bucket_group set removal_token=null,removal_bucket_id=null where id=p_group_id and removal_token=p_token and bucket_id is not null;
end $$;
create or replace function garments_access.file_registry() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from garments_access.app_user where user_id=auth.uid() and is_active) then raise exception 'Enabled account required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',g.id::text,'group',g."group",'description',g.description,'bucket_id',coalesce(g.bucket_id,g.removal_bucket_id),'private',not coalesce(b.public,false),'max_bytes',coalesce(b.file_size_limit,10485760),'mime',coalesce(b.allowed_mime_types,array['application/pdf','image/jpeg','image/png','image/webp']),'version',g.version,'removing',g.removal_token is not null,'route_count',(select count(*) from garments_access.app_file_route r where r.bucket_group_id=g.id),'attachment_count',(select count(*) from garments_erp.attachments a where a.bucket_group_id=g.id)) order by g.id),'[]'::jsonb) from garments_erp.bucket_group g left join storage.buckets b on b.id=g.bucket_id where b.id is not null or (g.removal_token is not null and garments_access.has_screen_permission('adminRoles','view')));
end $$;
-- The group row lock serialises uploads/routing changes with removal preparation.
create or replace function garments_access.save_file_route(p_key text,p_group_id bigint,p_mimes text[],p_max_bytes bigint,p_enabled boolean,p_version bigint) returns void language plpgsql security definer set search_path='' as $$
declare r garments_access.app_file_route;t jsonb;g garments_erp.bucket_group;b storage.buckets;
begin
 perform garments_access.require_administrator();
 t:=garments_access.file_target_definition(p_key);
 select * into strict r from garments_access.app_file_route where target_key=p_key for update;
 if r.version is distinct from p_version then raise exception 'Route changed. Reload before saving' using errcode='40001';end if;
 select * into strict g from garments_erp.bucket_group where id=p_group_id for update;
 select * into strict b from storage.buckets where id=g.bucket_id;
 if g.removal_token is not null then raise exception 'Bucket removal is in progress';end if;
 if b.public then raise exception 'Choose a private bucket group';end if;
 if p_mimes is null or cardinality(p_mimes)=0 or array_position(p_mimes,null) is not null or not(p_mimes<@array['application/pdf','image/jpeg','image/png','image/webp']::text[]) then raise exception 'Choose supported file types';end if;
 if b.allowed_mime_types is not null and not(p_mimes<@b.allowed_mime_types) then raise exception 'File types exceed the bucket rules';end if;
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
 if g.removal_token is not null then raise exception 'Bucket removal is in progress';end if;
 if b.public then raise exception 'Private bucket required';end if;
 if p_filename is null or length(trim(p_filename))=0 or length(p_filename)>240 or p_filename~'[[:cntrl:]]' then raise exception 'Invalid filename';end if;
 if p_size is null or p_size<=0 or p_size>least(coalesce(b.file_size_limit,10485760),(t->>'max_bytes')::bigint,10485760) then raise exception 'File exceeds upload limit';end if;
 if p_mime is null or not ((t->'mime') ? p_mime) or (b.allowed_mime_types is not null and not(p_mime=any(b.allowed_mime_types))) then raise exception 'Unsupported file type';end if;
 insert into garments_access.app_file_upload(target_key,record_id,bucket_group_id,bucket_id,storage_path,previous_attachment_id,filename,mime_type,byte_size,created_by,employee_id)
 values(p_key,p_record_id,g.id,g.bucket_id,concat(t->>'table','/',p_record_id,'/',t->>'slot','/',gen_random_uuid()),(t->>'current')::bigint,p_filename,p_mime,p_size,auth.uid(),eid) returning * into r;
 return to_jsonb(r)||jsonb_build_object('id',r.id::text,'bucket_group_id',r.bucket_group_id::text);
end $$;
create function public.erp_create_bucket_group(p_group text,p_description text,p_mimes text[],p_max_bytes bigint) returns jsonb language sql security invoker set search_path='' as $f$ select garments_access.create_bucket_group(p_group,p_description,p_mimes,p_max_bytes); $f$;
revoke all on function public.erp_create_bucket_group(text,text,text[],bigint),garments_access.create_bucket_group(text,text,text[],bigint) from public,anon;
grant execute on function public.erp_create_bucket_group(text,text,text[],bigint),garments_access.create_bucket_group(text,text,text[],bigint) to authenticated;
create function public.erp_prepare_bucket_removal(p_group_id bigint,p_version bigint,p_confirm text) returns jsonb language sql security invoker set search_path='' as $f$ select garments_access.prepare_bucket_removal(p_group_id,p_version,p_confirm); $f$;
revoke all on function public.erp_prepare_bucket_removal(bigint,bigint,text),garments_access.prepare_bucket_removal(bigint,bigint,text) from public,anon;
grant execute on function public.erp_prepare_bucket_removal(bigint,bigint,text),garments_access.prepare_bucket_removal(bigint,bigint,text) to authenticated;
create function public.erp_finish_bucket_removal(p_group_id bigint,p_token uuid) returns void language sql security invoker set search_path='' as $f$ select garments_access.finish_bucket_removal(p_group_id,p_token); $f$;
revoke all on function public.erp_finish_bucket_removal(bigint,uuid),garments_access.finish_bucket_removal(bigint,uuid) from public,anon;
grant execute on function public.erp_finish_bucket_removal(bigint,uuid),garments_access.finish_bucket_removal(bigint,uuid) to authenticated;
create function public.erp_cancel_bucket_removal(p_group_id bigint,p_token uuid) returns void language sql security invoker set search_path='' as $f$ select garments_access.cancel_bucket_removal(p_group_id,p_token); $f$;
revoke all on function public.erp_cancel_bucket_removal(bigint,uuid),garments_access.cancel_bucket_removal(bigint,uuid) from public,anon;
grant execute on function public.erp_cancel_bucket_removal(bigint,uuid),garments_access.cancel_bucket_removal(bigint,uuid) to authenticated;
commit;
