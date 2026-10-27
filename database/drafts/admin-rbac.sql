-- REVIEW DRAFT, NOT APPLIED. This is not a Supabase CLI migration.
-- This additive foundation alone DOES NOT secure existing business tables.
-- First link an explicitly authorised Supabase Auth user to the real employee,
-- then add/test business-table RLS and transactional command APIs before launch.
begin;
create schema if not exists garments_access;
revoke all on schema garments_access from public, anon;

create table garments_access.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  system_key text unique check (system_key is null or system_key = 'administrator'),
  description text not null default '',
  protected boolean not null default false,
  version bigint not null default 1 check (version > 0)
);
create table garments_access.permissions (
  resource text not null,
  action text not null check (action in ('view','create','edit','format','export','print')),
  primary key (resource, action)
);
create table garments_access.role_permissions (
  role_id uuid not null references garments_access.roles(id) on delete cascade,
  resource text not null,
  action text not null,
  primary key (role_id, resource, action),
  foreign key (resource, action) references garments_access.permissions(resource, action)
);
create table garments_access.memberships (
  user_id uuid primary key references auth.users(id),
  employee_id bigint not null unique references garments_erp.employee(id),
  role_id uuid not null references garments_access.roles(id),
  enabled boolean not null default false,
  version bigint not null default 1 check (version > 0)
);
create index memberships_role_id_idx on garments_access.memberships(role_id);
create table garments_access.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  target text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_created_at_idx on garments_access.audit_events(created_at desc);

alter table garments_access.roles enable row level security;
alter table garments_access.permissions enable row level security;
alter table garments_access.role_permissions enable row level security;
alter table garments_access.memberships enable row level security;
alter table garments_access.audit_events enable row level security;
revoke all on all tables in schema garments_access from public, anon, authenticated;
revoke all on all sequences in schema garments_access from public, anon, authenticated;

-- Fixed, private helper: reads current membership instead of editable JWT metadata.
-- No browser execution grant is included in this review draft.
create function garments_access.has_permission(p_resource text, p_action text)
returns boolean language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists (
   select 1 from garments_access.memberships m
   join garments_access.roles r on r.id = m.role_id
   join garments_access.role_permissions rp on rp.role_id = m.role_id
   where m.user_id = (select auth.uid()) and m.enabled
     and rp.resource = p_resource and rp.action = p_action
     and (p_resource not in ('adminAccess','adminRoles','adminAudit')
          or r.system_key = 'administrator')
     and exists (
       select 1 from garments_access.role_permissions visible
       where visible.role_id = m.role_id and visible.resource = p_resource
         and visible.action = 'view'
     )
 );
$$;
revoke all on function garments_access.has_permission(text,text) from public, anon, authenticated;
commit;
