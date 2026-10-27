-- REVIEW DRAFT ONLY. Not applied. No live buckets, policies or grants were changed.
-- The registry table is garments_erp.bucket_group (renamed from bucket_group_id).
-- attachments.bucket_group_id remains its FK column. Never duplicate the registry.
begin;
-- Provision only the five feature-sheet groups. Preserve existing registered IDs
-- and refuse public bucket reuse. Do not change unrelated existing public buckets.
do $provision$
declare definition record; registered garments_erp.bucket_group; chosen_bucket text; bucket_public boolean;
begin
 for definition in select * from (values
  ('job_worker_bills','garments-job-worker-bills','Bills from job workers'),
  ('fabric_bills','garments-fabric-bills','Yarn, knitting and dyeing bills'),
  ('items','garments-items','Item-related files except job worker bills'),
  ('raw_material_bills','garments-raw-material-bills','Raw material receipt bills'),
  ('employee','garments-employee','Employee supporting documents')
 ) as g(group_key,bucket_key,description) loop
  select * into registered from garments_erp.bucket_group where "group"=definition.group_key for update;
  chosen_bucket:=coalesce(registered.bucket_id,definition.bucket_key);
  select public into bucket_public from storage.buckets where id=chosen_bucket;
  if found and bucket_public then raise exception 'Group % points to a public bucket; review before provisioning',definition.group_key;end if;
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values(chosen_bucket,chosen_bucket,false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
   on conflict(id) do nothing;
  if registered.id is null then
   insert into garments_erp.bucket_group(bucket_id,"group",description) values(chosen_bucket,definition.group_key,definition.description);
  elsif registered.bucket_id is null then
   update garments_erp.bucket_group set bucket_id=chosen_bucket where id=registered.id;
  end if;
 end loop;
end $provision$;
alter table garments_erp.bucket_group add column version bigint not null default 1 check (version>0);
create unique index bucket_group_one_bucket_idx on garments_erp.bucket_group(bucket_id) where bucket_id is not null;
create unique index attachments_group_path_idx on garments_erp.attachments(bucket_group_id,storage_path) where bucket_group_id is not null and storage_path is not null;

-- Cross-service uploads cannot be made atomic with a Postgres transaction.
-- Reserve first, upload using a server-issued reservation and unique path/token, then finalise
-- the metadata + parent FK in one DB transaction with a parent-record lock.
create table garments_access.app_file_upload (
 id uuid primary key default gen_random_uuid(),
 bucket_group_id bigint not null references garments_erp.bucket_group(id) on delete restrict,
 bucket_id text not null references storage.buckets(id) on delete restrict,
 storage_path text not null,
 target_key text not null check (target_key in ('yarnBill','knittingBill','dyedBill','workerBill','itemImage','rawMaterialBill','employeeDocument1','employeeDocument2')),
 record_id bigint not null check (record_id>0),
 expected_previous_attachment_id bigint references garments_erp.attachments(id) on delete restrict,
 attachment_id bigint unique references garments_erp.attachments(id) on delete restrict,
 original_filename text not null,
 mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
 byte_size bigint not null check (byte_size>0 and byte_size<=10485760),
 created_by uuid not null references auth.users(id),
 uploaded_by_employee_id bigint not null references garments_erp.employee(id),
 status text not null default 'pending' check (status in ('pending','ready','cancelled','cleanup_required')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '15 minutes',
 upload_token_expires_at timestamptz not null default now()+interval '2 hours',
 finalised_at timestamptz,
 unique(bucket_id,storage_path),
 check ((status='ready')=(attachment_id is not null)),
 check (expires_at>created_at),
 check (upload_token_expires_at>=expires_at)
);
create index app_file_upload_actor_idx on garments_access.app_file_upload(created_by);
create index app_file_upload_group_idx on garments_access.app_file_upload(bucket_group_id);
create index app_file_upload_employee_idx on garments_access.app_file_upload(uploaded_by_employee_id);
create index app_file_upload_previous_idx on garments_access.app_file_upload(expected_previous_attachment_id);
create index app_file_upload_cleanup_idx on garments_access.app_file_upload(expires_at) where status in ('pending','cleanup_required');
alter table garments_access.app_file_upload enable row level security;
revoke all on garments_access.app_file_upload from public,anon,authenticated;
-- Administration-only configuration command. It is not granted to browser roles
-- in this draft. A future named invoker wrapper must use the guarded function.
create function garments_access.update_bucket_settings(p_group_id bigint,p_expected_version bigint,p_description text,p_bucket_id text,p_max_bytes bigint)
returns void language plpgsql security definer set search_path='' as $$
declare current_group garments_erp.bucket_group; destination storage.buckets;
begin
 perform pg_advisory_xact_lock(71426,2);
 perform garments_access.require_administrator();
 select * into current_group from garments_erp.bucket_group where id=p_group_id for update;
 if not found then raise exception 'File group no longer exists';end if;
 if current_group.version is distinct from p_expected_version then raise exception 'Bucket settings changed. Reload before saving' using errcode='40001';end if;
 if p_max_bytes is null or p_max_bytes<=0 or p_max_bytes>10485760 then raise exception 'Upload limit must be between 1 byte and 10 MB';end if;
 if p_description is null or length(trim(p_description))>500 then raise exception 'Description must be at most 500 characters';end if;
 select * into destination from storage.buckets where id=p_bucket_id for update;
 if not found or destination.public then raise exception 'Choose an existing verified private bucket';end if;
 if exists(select 1 from garments_erp.bucket_group g where g.id<>p_group_id and g.bucket_id=p_bucket_id) then raise exception 'Bucket is already registered to another group';end if;
 if current_group.bucket_id is distinct from p_bucket_id and (
  exists(select 1 from garments_erp.attachments a where a.bucket_group_id=p_group_id)
  or exists(select 1 from garments_access.app_file_upload u where u.bucket_group_id=p_group_id and u.status in ('pending','ready','cleanup_required'))
 ) then raise exception 'This group has files or uploads in progress. Its bucket cannot be redirected';end if;
 update garments_erp.bucket_group set description=trim(p_description),bucket_id=p_bucket_id,version=version+1 where id=p_group_id;
 update storage.buckets set file_size_limit=p_max_bytes where id=p_bucket_id;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details)
 values(auth.uid(),'Updated private bucket settings','bucket_group',p_group_id::text,jsonb_build_object('bucket_id',p_bucket_id,'max_bytes',p_max_bytes));
end;
$$;
revoke all on function garments_access.update_bucket_settings(bigint,bigint,text,text,bigint) from public,anon,authenticated;

-- Existing attachments/bucket_group remain RLS-enabled. No broad browser grant,
-- Storage policy or public URL is introduced by this foundation.
commit;

-- Activation is intentionally separate and must be tested against actual roles:
-- 1. beginUpload validates active actor, permitted resource/action, real parent,
--    exact allowed FK slot/group, byte/type limit and previous attachment ID.
--    It resolves bucket_id through bucket_group plus storage.buckets.public=false.
--    The server allocates the random path; neither filename nor client bucket is trusted.
-- 2. Server Storage client issues signed upload URL; browser uses upsert=false.
-- 3. finaliseUpload checks the exact Storage object metadata and actual MIME/signature,
--    parent current attachment + permission again, locks reservation/parent,
--    inserts attachments metadata and updates the scalar parent FK atomically.
--    It marks reservation ready, and writes an audit. It must be idempotent.
-- 4. readAttachment checks current record access via approved FK relationships,
--    then issues a short-lived signed URL or streams the private object.
-- 5. cancelUpload marks cleanup_required. Trusted cleanup uses Storage API remove,
--    NEVER DELETE FROM storage.objects, then marks cancelled only after confirmed
--    object removal AND upload_token_expires_at has passed (plus clock-skew grace).
--    Standard signed-upload tokens last 2 hours; the 15-minute reservation deadline
--    does not revoke them. Keep retrying cleanup_required while a token can be replayed.
--    An expiry worker retries failed cleanup without removing any
--    object referenced by a ready attachment/parent. Do not rely on browser cleanup.
-- 6. Replacements use a new path/attachment, compare the old FK and preserve history.
--    No overwrite or hard-delete UI is provided. Shared/multiple parent references
--    require all relevant read checks and explicit retention rules before activation.
