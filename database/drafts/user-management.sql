-- APPLIED on 27 October 2026 as migration 20261027173551.
-- Canonical applied copy: ../applied/20261027173551_create_user_management_structure.sql
-- Do not rerun this former draft. Supersedes the earlier admin-rbac.sql proposal.
-- This defines configuration storage only. It does not activate live access,
-- secure business tables, create login accounts or seed an administrator.
begin;
create schema if not exists garments_access;
revoke all on schema garments_access from public, anon;

create table garments_access.app_role (
 id bigint generated always as identity primary key,
 key text not null unique,
 name text not null,
 is_active boolean not null default true,
 is_system_admin boolean not null default false,
 version bigint not null default 1 check (version > 0)
);
-- A single protected Administrator role; many users can hold that role.
create unique index app_role_one_admin on garments_access.app_role(is_system_admin)
 where is_system_admin;

create table garments_access.app_resource (
 id bigint generated always as identity primary key,
 key text not null unique,
 name text not null,
 resource_type text not null check (resource_type in ('section','screen')),
 parent_resource_id bigint references garments_access.app_resource(id),
 route text,
 sort_order integer not null default 0,
 is_active boolean not null default true,
 admin_only boolean not null default false,
 check (parent_resource_id is null or parent_resource_id <> id),
 check (resource_type <> 'section' or route is null)
);
create index app_resource_parent_idx on garments_access.app_resource(parent_resource_id);

create table garments_access.app_role_resource_permission (
 id bigint generated always as identity primary key,
 app_role_id bigint not null references garments_access.app_role(id),
 app_resource_id bigint not null references garments_access.app_resource(id),
 can_view boolean not null default false,
 can_create boolean not null default false,
 can_edit boolean not null default false,
 can_delete boolean not null default false,
 can_format boolean not null default false,
 can_export boolean not null default false,
 can_print boolean not null default false,
 version bigint not null default 1 check (version > 0),
 unique (app_role_id, app_resource_id),
 check (can_view or not (can_create or can_edit or can_delete or can_format or can_export or can_print))
);
create index app_role_resource_resource_idx
 on garments_access.app_role_resource_permission(app_resource_id);

create table garments_access.app_db_table (
 id bigint generated always as identity primary key,
 schema_name text not null,
 table_name text not null,
 unique (schema_name, table_name)
);

create table garments_access.app_resource_table (
 id bigint generated always as identity primary key,
 app_resource_id bigint not null references garments_access.app_resource(id),
 app_db_table_id bigint not null references garments_access.app_db_table(id),
 relation_type text not null check (relation_type in ('primary','detail','lookup','report_source')),
 can_view boolean not null default false,
 can_create boolean not null default false,
 can_edit boolean not null default false,
 can_delete boolean not null default false,
 unique (app_resource_id, app_db_table_id),
 check (can_view or not (can_create or can_edit or can_delete)),
 check (relation_type not in ('lookup','report_source') or not (can_create or can_edit or can_delete))
);
create index app_resource_table_table_idx on garments_access.app_resource_table(app_db_table_id);

-- Employee profiles belong to HR. This is the stable link to Auth identity.
-- Disabling app access is independent from the employee's employment status.
create table garments_access.app_user (
 user_id uuid primary key references auth.users(id),
 employee_id bigint not null unique references garments_erp.employee(id),
 is_active boolean not null default false,
 version bigint not null default 1 check (version > 0),
 created_at timestamptz not null default now(),
 created_by uuid references auth.users(id)
);
create table garments_access.app_user_role (
 id bigint generated always as identity primary key,
 user_id uuid not null references garments_access.app_user(user_id),
 role_id bigint not null references garments_access.app_role(id),
 assigned_at timestamptz not null default now(),
 created_by uuid references auth.users(id),
 unique (user_id, role_id)
);
create index app_user_role_role_idx on garments_access.app_user_role(role_id);

create table garments_access.app_activity_log (
 id bigint generated always as identity primary key,
 actor_user_id uuid references auth.users(id),
 app_resource_id bigint references garments_access.app_resource(id),
 action text not null,
 target_type text not null,
 target_id text,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index app_activity_log_created_idx on garments_access.app_activity_log(created_at desc);
create index app_activity_log_actor_idx on garments_access.app_activity_log(actor_user_id);
create index app_activity_log_resource_idx on garments_access.app_activity_log(app_resource_id);

-- Default-deny storage. No client policies or callable admin APIs at this step.
alter table garments_access.app_role enable row level security;
alter table garments_access.app_resource enable row level security;
alter table garments_access.app_role_resource_permission enable row level security;
alter table garments_access.app_db_table enable row level security;
alter table garments_access.app_resource_table enable row level security;
alter table garments_access.app_user enable row level security;
alter table garments_access.app_user_role enable row level security;
alter table garments_access.app_activity_log enable row level security;
revoke all on all tables in schema garments_access from public, anon, authenticated;
revoke all on all sequences in schema garments_access from public, anon, authenticated;
commit;
