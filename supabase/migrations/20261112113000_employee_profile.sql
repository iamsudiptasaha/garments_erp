begin;

alter table garments_erp.employee add constraint employee_primary_contact_unique unique (contacts_id);
alter table garments_erp.app_file_route add constraint employee_photo_image_types
  check (target_key <> 'employeePhoto' or
    allowed_mime_types <@ array['image/jpeg','image/png','image/webp']::text[]);

create function garments_access.profile_employee_id() returns bigint
language sql stable security definer set search_path = '' as $$
  select employee_id from garments_access.app_user
  where user_id = auth.uid() and garments_access.session_ready()
$$;
revoke all on function garments_access.profile_employee_id() from public, anon, authenticated;

create or replace function garments_erp.stamp_employee_operator() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor bigint;
begin
 if auth.uid() is null then return new;end if;
 if tg_op='UPDATE' and old.id=garments_access.profile_employee_id()
   and new.employee_photo is distinct from old.employee_photo
   and (to_jsonb(new)-array['employee_photo','updated_at']) =
       (to_jsonb(old)-array['employee_photo','updated_at']) then
   return new;
 end if;
 if not garments_access.has_screen_permission('employees',case when tg_op='INSERT' then 'create' else 'edit' end)
   then raise exception 'Employee write access required' using errcode='42501';end if;
 select employee_id into strict actor from garments_access.app_user where user_id=auth.uid();
 new.verified_by_employee_id:=actor;new.is_verified:=true;
 if tg_op='INSERT' then
  new.is_active:=true;new.activated_by_employee_id:=actor;
 elsif new.is_active is distinct from old.is_active then new.activated_by_employee_id:=actor;
 else new.activated_by_employee_id:=old.activated_by_employee_id;
 end if;
 return new;
end $$;

create or replace function garments_erp.file_record(p_key text,p_id bigint,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t jsonb;row_data jsonb;
begin
 t:=garments_erp.file_target(p_key);
 if not garments_access.has_screen_permission(t->>'resource',p_action) and not
  coalesce(p_key='employeePhoto' and p_action in ('view','edit') and p_id=garments_access.profile_employee_id(),false)
 and not
  (p_key='itemImage' and p_action='view' and garments_access.has_screen_permission('productionJobs','view')
   and exists(select 1 from garments_erp.production p join garments_erp.item_part ip on ip.id=p.item_part_id where ip.item_id=p_id))
 then raise exception 'No permission for this attachment' using errcode='42501';end if;
 execute format('select to_jsonb(r) from garments_erp.%I r where id=$1',t->>'table') into row_data using p_id;
 if row_data is null then raise exception 'Save the record in Supabase before attaching a file';end if;
 return t||jsonb_build_object('current',row_data->(t->>'slot'));
end $$;

create function garments_erp.my_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'employeeId', e.id::text, 'name', c.company_name, 'phone', p.phone,
    'photo', e.employee_photo::text, 'email', a.email,
    'roles', (select coalesce(jsonb_agg(r.name order by r.name),'[]'::jsonb)
              from garments_access.app_user_role ur
              join garments_access.app_role r on r.id=ur.role_id and r.is_active
              where ur.user_id=a.id))
  from garments_erp.employee e
  join garments_erp.contacts c on c.id=e.contacts_id
  join auth.users a on a.id=auth.uid()
  left join garments_erp.contact_items p on p.contact_id=c.id and p.primary_phone
  where e.id=garments_access.profile_employee_id()
$$;

create function garments_erp.save_my_profile(p_name text, p_phone text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  employee_id bigint;
  contact bigint;
  name text := btrim(p_name);
  phone text := nullif(btrim(p_phone), '');
begin
  perform pg_catalog.pg_advisory_xact_lock(71426,1);
  employee_id := garments_access.profile_employee_id();
  if employee_id is null then
    raise exception 'Verified ERP session required' using errcode='42501';
  end if;
  if name is null or length(name) not between 1 and 160 or name ~ '[[:cntrl:]]' then
    raise exception 'Enter a valid name';
  end if;
  if phone is not null and (phone !~ '^\+?[0-9 ()-]+$' or
       length(regexp_replace(phone, '[^0-9]', '', 'g')) not between 7 and 15
       or length(phone)>32) then
    raise exception 'Enter a valid primary phone';
  end if;
  select c.id into strict contact
  from garments_erp.employee e join garments_erp.contacts c on c.id=e.contacts_id
  where e.id=employee_id for update of e,c;
  update garments_erp.contacts set company_name=name,updated_at=now()
    where id=contact and company_name is distinct from name;
  if phone is null then
    update garments_erp.contact_items set primary_phone=false,updated_at=now()
    where contact_id=contact and primary_phone;
  else
    insert into garments_erp.contact_items(contact_id,phone,primary_phone)
    values(contact,phone,true)
    on conflict(contact_id) where primary_phone do update
    set phone=excluded.phone,updated_at=now();
  end if;
end;
$$;
revoke all on function garments_erp.save_my_profile(text,text) from public, anon;
grant execute on function garments_erp.save_my_profile(text,text) to authenticated;

create function garments_erp.remove_my_photo(p_expected bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update garments_erp.employee set employee_photo=null
  where id=garments_access.profile_employee_id()
    and employee_photo=p_expected;
  if not found then
    raise exception 'Photo changed or access unavailable. Reload and try again.';
  end if;
  insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details)
  values(auth.uid(),'Removed employee photo','employee',garments_access.profile_employee_id()::text,
         jsonb_build_object('attachment_id',p_expected::text));
end;
$$;
revoke all on function garments_erp.my_profile(), garments_erp.remove_my_photo(bigint) from public, anon;
grant execute on function garments_erp.my_profile(), garments_erp.remove_my_photo(bigint) to authenticated;
create or replace function garments_erp.file_read(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare upload garments_erp.app_file_upload; target jsonb; attachment garments_erp.attachments; bucket garments_erp.bucket_group;
begin
  select * into upload from garments_erp.app_file_upload where attachment_id=p_id and status='ready';
  if not found then
    -- Historical photos can predate the upload ledger. Trust the live Employee FK.
    select e.id into upload.record_id
    from garments_erp.employee e
    where e.employee_photo=p_id
      and (e.id=garments_access.profile_employee_id() or
           garments_access.has_screen_permission('employees','view'))
    order by e.id limit 1;
    if not found then raise exception 'Attachment is not registered to a record'; end if;
    upload.target_key := 'employeePhoto';
  end if;
  target:=garments_erp.file_record(upload.target_key,upload.record_id,'view');
  if upload.target_key='workerBill' and target->>'current' is distinct from p_id::text then
    raise exception 'Attachment is no longer linked to the worker bill' using errcode='42501';
  end if;
  if upload.target_key='employeePhoto' and target->>'current' is distinct from p_id::text
     and not garments_access.has_screen_permission('employees','view') then
    raise exception 'Photo is no longer linked to the employee' using errcode='42501';
  end if;
  select * into strict attachment from garments_erp.attachments where id=p_id;
  select * into strict bucket from garments_erp.bucket_group where id=attachment.bucket_group_id;
  if exists(select 1 from storage.buckets where id=bucket.bucket_id and public) then
    raise exception 'Private bucket required';
  end if;
  return jsonb_build_object('bucket_id',bucket.bucket_id,'storage_path',attachment.storage_path);
end $$;
create or replace function public.erp_access_snapshot() returns jsonb
language sql security invoker set search_path = '' as $$
  select garments_access.access_snapshot() || coalesce(
    (select jsonb_build_object('profilePhoto',profile->>'photo','profileName',profile->>'name')
     from garments_erp.my_profile() as profile where profile is not null), '{}'::jsonb)
$$;

create function public.erp_my_profile() returns jsonb
language sql security invoker set search_path = '' as $$
  select garments_erp.my_profile()
$$;
create function public.erp_save_my_profile(p_name text,p_phone text) returns void
language sql security invoker set search_path = '' as $$
  select garments_erp.save_my_profile(p_name,p_phone)
$$;
create function public.erp_remove_my_photo(p_expected bigint) returns void
language sql security invoker set search_path = '' as $$
  select garments_erp.remove_my_photo(p_expected)
$$;
revoke all on function public.erp_my_profile(), public.erp_save_my_profile(text,text),
  public.erp_remove_my_photo(bigint) from public, anon;
grant execute on function public.erp_my_profile(), public.erp_save_my_profile(text,text),
  public.erp_remove_my_photo(bigint) to authenticated;

commit;
