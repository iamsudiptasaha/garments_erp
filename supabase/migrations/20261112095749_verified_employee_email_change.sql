begin;

alter table garments_erp.contact_items add column email text;
alter table garments_erp.contact_items add column primary_email boolean not null default false;
alter table garments_erp.contact_items add constraint contact_items_primary_email_has_address
  check (not primary_email or nullif(btrim(email), '') is not null);
create unique index contact_items_one_primary_email
  on garments_erp.contact_items(contact_id) where primary_email;

-- Store authorization for the requested address. GoTrue owns the OTP and its verification.
create table garments_access.pending_employee_email (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid not null,
  contact_id bigint not null references garments_erp.contacts(id),
  old_email text not null,
  new_email text not null,
  expires_at timestamptz not null
);
alter table garments_access.pending_employee_email enable row level security;
revoke all on garments_access.pending_employee_email from public, anon, authenticated;

create function garments_access.authorize_employee_email_change(p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  address text := lower(btrim(p_email));
  contact bigint;
  current_email text;
begin
  if not garments_access.session_ready() then
    raise exception 'Verified ERP session required' using errcode = '42501';
  end if;
  if address is null or length(address) > 254
     or address !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Enter a valid new email';
  end if;
  select e.contacts_id, a.email into strict contact, current_email
  from garments_access.app_user u
  join garments_erp.employee e on e.id = u.employee_id
  join auth.users a on a.id = u.user_id
  where u.user_id = auth.uid();
  if current_email is null or lower(current_email) = address then
    raise exception 'Enter a different email';
  end if;
  if exists (
    select 1 from garments_access.app_user u
    join garments_erp.employee e on e.id = u.employee_id
    where e.contacts_id = contact and u.user_id <> auth.uid()
  ) then
    raise exception 'This contact is linked to another ERP account';
  end if;
  insert into garments_access.pending_employee_email
    (user_id, session_id, contact_id, old_email, new_email, expires_at)
  values (auth.uid(), (auth.jwt()->>'session_id')::uuid, contact, current_email, address,
          now() + interval '15 minutes')
  on conflict (user_id) do update set
    session_id = excluded.session_id, contact_id = excluded.contact_id,
    old_email = excluded.old_email, new_email = excluded.new_email, expires_at = excluded.expires_at;
  return address;
end;
$$;
revoke all on function garments_access.authorize_employee_email_change(text) from public, anon;
grant execute on function garments_access.authorize_employee_email_change(text) to authenticated;

create function public.erp_authorize_employee_email_change(p_email text) returns text
language sql security invoker set search_path = '' as $$
  select garments_access.authorize_employee_email_change(p_email);
$$;
revoke all on function public.erp_authorize_employee_email_change(text) from public, anon;
grant execute on function public.erp_authorize_employee_email_change(text) to authenticated;

create function garments_access.sync_verified_employee_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  pending garments_access.pending_employee_email;
  contact bigint;
  desired text;
  completed boolean := old.email is distinct from new.email;
begin
  -- Password and other Auth changes can include unchanged email fields.
  if not completed and (new.email_change is not distinct from old.email_change
                       or nullif(new.email_change, '') is null) then return new; end if;
  if not exists(select 1 from garments_access.app_user where user_id = old.id) then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(71426,1);
  select e.contacts_id into contact
  from garments_access.app_user u
  join garments_erp.employee e on e.id = u.employee_id and e.is_active
  where u.user_id = old.id and u.is_active and not u.must_change_password;
  select * into pending from garments_access.pending_employee_email where user_id = old.id for update;
  desired := lower(case when completed then new.email else new.email_change end);
  if contact is null or pending.user_id is null or pending.contact_id <> contact
     or pending.old_email is distinct from old.email
     or pending.new_email is distinct from desired or pending.expires_at <= now()
     or not exists(select 1 from auth.sessions s where s.id = pending.session_id
          and s.user_id = old.id and s.aal = 'aal2' and (s.not_after is null or s.not_after > now()))
     or not exists(select 1 from auth.mfa_factors f where f.user_id = old.id
          and f.factor_type = 'totp' and f.status = 'verified') then
    raise exception 'Start a new email change from a verified ERP session' using errcode = '42501';
  end if;
  if not completed then return new; end if;
  if lower(old.email_change) is distinct from desired then
    raise exception 'Verify the new email through Supabase Auth' using errcode = '42501';
  end if;
  if exists(
    select 1 from garments_access.app_user u join garments_erp.employee e on e.id = u.employee_id
    where e.contacts_id = contact and u.user_id <> old.id
  ) then
    raise exception 'This contact is linked to another ERP account' using errcode = '42501';
  end if;

  update garments_erp.contact_items set email = new.email, updated_at = now()
    where contact_id = contact and primary_email;
  if not found then
    insert into garments_erp.contact_items(contact_id, email, primary_email)
    values (contact, new.email, true);
  end if;
  insert into garments_access.app_activity_log(actor_user_id, action, target_type, target_id, details)
  values (old.id, 'Changed login email', 'app_user', old.id::text,
          jsonb_build_object('old_email', old.email, 'new_email', new.email,
                             'contact_id', contact, 'completed_at', now()));
  delete from garments_access.pending_employee_email where user_id = old.id;
  return new;
end;
$$;
revoke all on function garments_access.sync_verified_employee_email() from public, anon, authenticated;
create trigger sync_verified_employee_email
before update of email, email_change on auth.users for each row
execute function garments_access.sync_verified_employee_email();

commit;
