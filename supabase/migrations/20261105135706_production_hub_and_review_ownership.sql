begin;
set local lock_timeout = '10s';
-- Flush existing deferred validators statement-by-statement before ALTER TABLE
-- follows a backfill; otherwise populated databases retain pending trigger events.
set constraints all immediate;

-- Production is the permanent identity; jobs are individual stage attempts.
create table garments_erp.production (
  id bigint generated always as identity primary key,
  item_part_id bigint not null unique references garments_erp.item_part(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into garments_erp.production(item_part_id)
select distinct item_part_id from garments_erp.job;

alter table garments_erp.job
  add column production_id bigint references garments_erp.production(id),
  add column latest boolean not null default false;
update garments_erp.job j set production_id = p.id
from garments_erp.production p where p.item_part_id = j.item_part_id;
alter table garments_erp.job alter column production_id set not null;
-- Legacy rows have no trustworthy movement log. Pick a deterministic current
-- candidate, without fabricating verifier identities or historical transitions.
with ranked as (
  select id, row_number() over(partition by production_id order by
    (complete_date is null) desc, coalesce(start_date, created_at::date) desc nulls last, id desc) n
  from garments_erp.job
)
update garments_erp.job j set latest = true from ranked r where r.id = j.id and r.n = 1;
create unique index job_one_current_per_production on garments_erp.job(production_id) where latest;
create index job_production_attempts on garments_erp.job(production_id, id);
alter table garments_erp.job add constraint job_production_identity unique(production_id, id);

alter table garments_erp.job_assignees add column production_id bigint references garments_erp.production(id);
update garments_erp.job_assignees a set production_id = j.production_id
from garments_erp.job j where j.id = a.job_id;
delete from garments_erp.job_assignees a using garments_erp.job_assignees b
where a.production_id = b.production_id and a.assigned_employees_id = b.assigned_employees_id and a.id > b.id;
alter table garments_erp.job_assignees drop column job_id;
alter table garments_erp.job_assignees alter column production_id set not null;
alter table garments_erp.job_assignees add unique(production_id, assigned_employees_id);

create table garments_erp.task_board_data (
  id bigint generated always as identity primary key,
  production_id bigint not null unique references garments_erp.production(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table garments_erp.flags_list (
  id bigint generated always as identity primary key,
  name text not null unique check (name = btrim(name) and name <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table garments_erp.task_board_data_flag (
  id bigint generated always as identity primary key,
  task_board_data_id bigint not null references garments_erp.task_board_data(id),
  task_board_data_flag_id bigint not null references garments_erp.flags_list(id),
  unique(task_board_data_id, task_board_data_flag_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on garments_erp.task_board_data_flag(task_board_data_flag_id);
insert into garments_erp.task_board_data(production_id) select id from garments_erp.production;

create table garments_erp.job_item_status_list (
  id bigint generated always as identity primary key,
  job_id bigint not null unique references garments_erp.job(id),
  date date,
  item_status_list_id bigint references garments_erp.item_status_list(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into garments_erp.job_item_status_list(job_id, date, item_status_list_id)
select id, coalesce(updated_at, created_at)::date, item_status_list_id from garments_erp.job;
drop trigger record_job_status_change on garments_erp.job;
drop function garments_access.record_job_status_change();
drop table garments_erp.job_status_history;

create table garments_erp.job_transition_log (
  id bigint generated always as identity primary key,
  production_id bigint not null references garments_erp.production(id),
  from_job_id bigint not null,
  to_job_id bigint not null,
  action text not null check(action in ('advance', 'rectify')),
  verified_by bigint not null references garments_erp.employee(id),
  actor_user_id uuid not null references auth.users(id),
  timestamp timestamptz not null default clock_timestamp(),
  reason text,
  check(from_job_id <> to_job_id),
  check(action <> 'rectify' or nullif(btrim(reason), '') is not null),
  foreign key(production_id, from_job_id) references garments_erp.job(production_id, id),
  foreign key(production_id, to_job_id) references garments_erp.job(production_id, id)
);
create index job_transition_production_order on garments_erp.job_transition_log(production_id, id);
create index on garments_erp.job_transition_log(from_job_id);
create index on garments_erp.job_transition_log(to_job_id);
create index on garments_erp.job_transition_log(verified_by);

-- Update the existing ownership guard before removing the old direct FK.
create or replace function garments_erp.check_production_variant_links() returns trigger
language plpgsql set search_path = '' as $$
begin
 if exists(select 1 from garments_erp.variant_item_per_job link join garments_erp.job j on j.id=link.job_id
   join garments_erp.production pr on pr.id=j.production_id join garments_erp.variant_item vi on vi.id=link.variant_item_id
   where pr.item_part_id<>vi.item_part_id) then raise exception 'Job variants must belong to the production item part';end if;
 if exists(select 1 from garments_erp.stage_pieces p join garments_erp.variant_item_per_job link on link.id=p.variant_item_per_job_id
   join garments_erp.variant_item vi on vi.id=link.variant_item_id join garments_erp.item_part ip on ip.id=vi.item_part_id
   join garments_erp.item_size_list sz on sz.id=p.item_size_list_id where ip.item_id<>sz.item_id)
   then raise exception 'Stage size must belong to the job item';end if;
 if exists(select 1 from garments_erp.stage_pieces p join garments_erp.variant_item_per_job link on link.id=p.variant_item_per_job_id
   join garments_erp.job j on j.id=link.job_id join garments_erp.stage s on s.id=j.stage_id where s.pp_stage or not s.track_pieces)
   then raise exception 'This stage does not track production pieces';end if;
 if exists(select 1 from garments_erp.challan_job_item_pieces p join garments_erp.challan_job_item ci on ci.id=p.challan_job_item_id
   join garments_erp.variant_item vi on vi.id=p.variant_item_id join garments_erp.item_part ip on ip.id=vi.item_part_id
   join garments_erp.item_size_list sz on sz.id=p.item_size_list_id where ip.item_id<>sz.item_id or not exists(
     select 1 from garments_erp.variant_item_per_job link where link.job_id=ci.job_id and link.variant_item_id=vi.id))
   then raise exception 'Challan variant and size must belong to its job';end if;
 return null;
end $$;
create constraint trigger check_production_variant_links after update on garments_erp.production
deferrable initially deferred for each row execute function garments_erp.check_production_variant_links();
alter table garments_erp.job drop column item_part_id, drop column item_status_list_id, drop column verify_employee_id;

-- Each production must retain one board, one current job and one status row per
-- job at transaction end, allowing an atomic current-job switch in between.
create function garments_erp.check_production_hub() returns trigger
language plpgsql set search_path = '' as $$
declare pid bigint;
begin
 pid := case when tg_table_name='production' then
   case when tg_op='DELETE' then old.id else new.id end
   else case when tg_op='DELETE' then (to_jsonb(old)->>'production_id')::bigint else (to_jsonb(new)->>'production_id')::bigint end end;
 perform 1 from garments_erp.production where id=pid for update;
 if not found then return null;end if;
 if (select count(*) from garments_erp.task_board_data where production_id=pid)<>1
   or (select count(*) from garments_erp.job where production_id=pid and latest)<>1
   then raise exception 'Production requires exactly one board and one current job';end if;
 if exists(select 1 from garments_erp.job j where j.production_id=pid and not exists(
   select 1 from garments_erp.job_item_status_list s where s.job_id=j.id))
   then raise exception 'Every job requires one editable status row';end if;
 return null;
end $$;
create function garments_erp.check_job_status_row() returns trigger
language plpgsql set search_path = '' as $$
declare jid bigint;
begin
 jid:=case when tg_op='DELETE' then old.job_id else new.job_id end;
 if exists(select 1 from garments_erp.job where id=jid) and not exists(
   select 1 from garments_erp.job_item_status_list where job_id=jid)
   then raise exception 'Every job requires one editable status row';end if;
 return null;
end $$;
create constraint trigger check_job_status_row after insert or update or delete on garments_erp.job_item_status_list
deferrable initially deferred for each row execute function garments_erp.check_job_status_row();
do $$ declare t text;begin
 foreach t in array array['production','job','task_board_data'] loop
  execute format('create constraint trigger check_production_hub after insert or update or delete on garments_erp.%I deferrable initially deferred for each row execute function garments_erp.check_production_hub()',t);
 end loop;
end $$;
create function garments_erp.keep_production_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
 if (tg_table_name='production' and (to_jsonb(new)->>'item_part_id') is distinct from (to_jsonb(old)->>'item_part_id'))
   or (tg_table_name<>'production' and (to_jsonb(new)->>'production_id') is distinct from (to_jsonb(old)->>'production_id'))
   then raise exception 'Production ownership cannot be changed';end if;
 return new;
end $$;
create trigger keep_production_identity before update on garments_erp.production
for each row execute function garments_erp.keep_production_identity();
create trigger keep_production_identity before update on garments_erp.job
for each row execute function garments_erp.keep_production_identity();
create trigger keep_production_identity before update on garments_erp.task_board_data
for each row execute function garments_erp.keep_production_identity();

-- Employee verification now uses the operator's existing portal identity.
alter table garments_erp.employee
 add column is_active boolean not null default true,
 add column is_verified boolean not null default false,
 add column activated_by_employee_id bigint references garments_erp.employee(id);
drop trigger invalidate_employee_verification on garments_erp.employee;
drop function garments_access.invalidate_employee_verification();
update garments_erp.employee set is_verified=(verified_by_employee_id is not null);
alter table garments_erp.employee add constraint employee_verified_has_actor check(not is_verified or verified_by_employee_id is not null);
alter table garments_erp.type_of_employment add column description text;

create or replace function garments_access.session_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'aal'='aal2',false)
 and exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()))
 and exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.factor_type='totp' and f.status='verified')
 and exists(select 1 from garments_access.app_user u join garments_erp.employee e on e.id=u.employee_id
   where u.user_id=auth.uid() and u.is_active and e.is_active and not u.must_change_password);
$$;

-- Fabric/inventory physical names and exact foreign keys from the reviewed ER.
alter table garments_erp.raw_material_check_in rename column date to inward_date;
alter table garments_erp.raw_material_check_in rename column quantity to billed_quantity;
alter table garments_erp.raw_material_check_in rename column price to billed_price;
alter table garments_erp.raw_material_purchase_order_item add unique(id,raw_material_item_id);
alter table garments_erp.raw_material_check_in
 drop constraint raw_material_receipt_line_matches_purchase,
 drop constraint raw_material_receipt_line_requires_purchase,
 add constraint raw_material_receipt_line_requires_material check(
   raw_material_purchase_order_item_id is null or raw_material_item_id is not null
 ),
 add constraint raw_material_receipt_line_material_identity foreign key(raw_material_purchase_order_item_id,raw_material_item_id)
 references garments_erp.raw_material_purchase_order_item(id,raw_material_item_id);
alter table garments_erp.raw_material_check_in drop column purchase_order_id, drop column raw_material_supplier_list_id;
alter table garments_erp.dyed_fabric_bill add column verified_by_employee_id bigint references garments_erp.employee(id);
alter table garments_erp.production_checklist add column tna_acquired_status_id bigint references garments_erp.item_status_list(id);

-- batch_no now stores the selected mapping ID, not the human-readable batch text.
alter table garments_erp.dyeing_program_item drop constraint fk_dpi_previous_batch;
alter table garments_erp.dyeing_program_item add column previous_batch_id bigint;
update garments_erp.dyeing_program_item i set previous_batch_id=b.id
from garments_erp.batch_no_lab_dip_version_map b where b.batch_no=i.batch_no;
alter table garments_erp.dyeing_program_item drop column batch_no;
alter table garments_erp.dyeing_program_item rename column previous_batch_id to batch_no;
alter table garments_erp.dyeing_program_item add constraint fk_dpi_previous_batch
 foreign key(batch_no) references garments_erp.batch_no_lab_dip_version_map(id);
create index on garments_erp.dyeing_program_item(batch_no);

-- fabric_name already exists in view_knitted_fabric_name; reuse that derived
-- projection instead of adding a stale persisted copy to knitting_bill_item.

create or replace view garments_erp.view_variant_item_lab_dip_status with(security_invoker=true) as
 select vi.id,vi.id as variant_item_id,pc.id as production_checklist_id,vi.lab_dip_id,
 l.edition,v.id as lab_dip_version_id,v.version,s.status as version_status,
 case when vi.lab_dip_id is null then 'Lab dip not selected'
 when v.id is null then 'No versions yet'
 when s.id is null then 'Status not recorded'
 when v.version>1 and s.sort_order<=3 then 'Redo '||v.version::text||' · '||s.status
 else s.status end as lab_dip_status
 from garments_erp.variant_item vi
 join garments_erp.item_part ip on ip.id=vi.item_part_id
 left join garments_erp.production_checklist pc on pc.item_id=ip.item_id
 left join garments_erp.lab_dip l on l.id=vi.lab_dip_id
 left join lateral(select vv.id,vv.version from garments_erp.lab_dip_version vv where vv.lab_dip_id=l.id order by vv.version desc limit 1)v on true
 left join garments_erp.lab_dip_version_item i on i.lab_dip_version_id=v.id and i.latest
 left join garments_erp.lab_dip_version_status s on s.id=i.lab_dip_status_id;
create or replace view garments_erp.view_default_lab_dip_version with(security_invoker=true) as
 select distinct on(l.color_map_by_brand_id,l.dyer_id) l.color_map_by_brand_id,l.dyer_id,l.id as lab_dip_id,l.edition,v.id as lab_dip_version_id,v.version,i.date,s.status
 from garments_erp.lab_dip l join garments_erp.lab_dip_version v on v.lab_dip_id=l.id
 join garments_erp.lab_dip_version_item i on i.lab_dip_version_id=v.id and i.latest
 join garments_erp.lab_dip_version_status s on s.id=i.lab_dip_status_id
 where s.sort_order>=4
 order by l.color_map_by_brand_id,l.dyer_id,i.date desc nulls last,l.edition desc,v.version desc,v.id desc;


-- Reviews are physically stored ONLY in lab_dip_version_item.
drop trigger record_lab_dip_review on garments_erp.lab_dip_version;
drop function garments_access.record_lab_dip_review();
insert into garments_erp.lab_dip_version_item(lab_dip_version_id,date,comments,lab_dip_status_id,latest)
select v.id,v.date,v.comments,v.lab_dip_status_id,true from garments_erp.lab_dip_version v
where not exists(select 1 from garments_erp.lab_dip_version_item i where i.lab_dip_version_id=v.id and i.latest);
alter table garments_erp.lab_dip_version drop column date, drop column comments, drop column lab_dip_status_id;

create or replace function garments_erp.guard_lab_dip_version() returns trigger
language plpgsql set search_path='' as $$
declare pid bigint; maximum integer;
begin
 pid:=case when tg_op='DELETE' then old.lab_dip_id else new.lab_dip_id end;
 perform 1 from garments_erp.lab_dip where id=pid for update;
 if not found then raise exception 'Lab dip does not exist';end if;
 if tg_op='UPDATE' and (new.lab_dip_id,new.version) is distinct from (old.lab_dip_id,old.version)
   then raise exception 'A version cannot be moved or renumbered';end if;
 if exists(select 1 from garments_erp.lab_dip_version v join garments_erp.lab_dip_version_item i on i.lab_dip_version_id=v.id and i.latest
   join garments_erp.lab_dip_version_status s on s.id=i.lab_dip_status_id where v.lab_dip_id=pid and s.sort_order>=4)
   then raise exception 'This edition is complete. Create a new edition for further attempts';end if;
 select max(version) into maximum from garments_erp.lab_dip_version where lab_dip_id=pid;
 if tg_op='INSERT' then
  if new.version<>coalesce(maximum,0)+1 then raise exception 'Versions must start at 1 and increase by one';end if;
  if maximum is not null and not exists(select 1 from garments_erp.lab_dip_version v
    join garments_erp.lab_dip_version_item i on i.lab_dip_version_id=v.id and i.latest
    join garments_erp.lab_dip_version_status s on s.id=i.lab_dip_status_id
    where v.lab_dip_id=pid and v.version=maximum and s.sort_order=3)
    then raise exception 'The latest version must be Failed before adding another version';end if;
 elsif old.version<>maximum then raise exception 'Only the latest version may be changed';end if;
 if tg_op='DELETE' then return old;end if;
 if new.attached_swatch then new.shade_card_no:=null;new.shade_card_option:=null;end if;
 return new;
end $$;

create function garments_erp.guard_lab_dip_version_item() returns trigger
language plpgsql set search_path='' as $$
declare v garments_erp.lab_dip_version; previous garments_erp.lab_dip_version_item;
begin
 if tg_op<>'INSERT' then raise exception 'Submitted reviews cannot be edited or deleted; add a review';end if;
 select * into strict v from garments_erp.lab_dip_version where id=new.lab_dip_version_id;
 perform 1 from garments_erp.lab_dip where id=v.lab_dip_id for update;
 if v.version<>(select max(version) from garments_erp.lab_dip_version where lab_dip_id=v.lab_dip_id)
   then raise exception 'Only the latest version may be reviewed';end if;
 select * into previous from garments_erp.lab_dip_version_item where lab_dip_version_id=v.id and latest;
 if exists(select 1 from garments_erp.lab_dip_version_status where id=previous.lab_dip_status_id and sort_order>=4)
   then raise exception 'This edition is complete. Create a new edition for further attempts';end if;
 if v.attached_swatch is distinct from coalesce((select sort_order=4 from garments_erp.lab_dip_version_status where id=new.lab_dip_status_id),false)
   then raise exception 'Attached swatch flag must match Attached Swatch status';end if;
 -- A separate trigger permits only this nested demotion, never review edits.
 update garments_erp.lab_dip_version_item set latest=false where lab_dip_version_id=v.id and latest;
 new.latest:=true;
 new.recorded_at:=clock_timestamp();
 return new;
end $$;
create function garments_erp.protect_lab_dip_review() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and pg_trigger_depth()>1 and old.latest and not new.latest
   and (to_jsonb(old)-'latest')=(to_jsonb(new)-'latest') then return new;end if;
 raise exception 'Submitted reviews cannot be edited or deleted; add a review';
end $$;
create trigger guard_lab_dip_version_item before insert on garments_erp.lab_dip_version_item
for each row execute function garments_erp.guard_lab_dip_version_item();
create trigger protect_lab_dip_review before update or delete on garments_erp.lab_dip_version_item
for each row execute function garments_erp.protect_lab_dip_review();

-- Read-only projection for SQL consumers; no duplicated review storage.
create view garments_erp.view_lab_dip_version_current with(security_invoker=true) as
select v.*,i.date,i.comments,i.lab_dip_status_id,i.id as review_id
from garments_erp.lab_dip_version v left join garments_erp.lab_dip_version_item i
on i.lab_dip_version_id=v.id and i.latest;

-- No newly created object inherits browser access. Guarded commands below are
-- the only portal write boundary; postgres/CI owns schema maintenance.
do $$ declare t text;begin
 foreach t in array array['production','task_board_data','flags_list','task_board_data_flag','job_item_status_list','job_transition_log'] loop
  execute format('alter table garments_erp.%I enable row level security',t);
  execute format('revoke all on garments_erp.%I from public,anon,authenticated',t);
  if t<>'job_transition_log' then
   execute format('create trigger zz_stamp_updated_at before insert or update on garments_erp.%I for each row execute function garments_access.stamp_updated_at()',t);
  end if;
  execute format('revoke all on sequence garments_erp.%I from public,anon,authenticated',t||'_id_seq');
 end loop;
end $$;
revoke all on garments_erp.view_lab_dip_version_current from public,anon,authenticated;

-- SQL commands and dependencies follow below.
create function garments_access.stamp_employee_operator() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor bigint;
begin
 if auth.uid() is null then return new;end if;
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
create trigger stamp_employee_operator before insert or update on garments_erp.employee
for each row execute function garments_access.stamp_employee_operator();

create function garments_access.set_employee_active(p_id bigint,p_active boolean,p_expected text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not garments_access.has_screen_permission('employees','edit') then raise exception 'Employee write access required' using errcode='42501';end if;
 if p_active is null then raise exception 'Choose active or inactive';end if;
 perform 1 from garments_erp.employee where id=p_id for update;
 if not found or md5(garments_access.employee_document(p_id)::text) is distinct from p_expected
   then raise exception 'Employee changed. Reload before saving.' using errcode='40001';end if;
 update garments_erp.employee set is_active=p_active where id=p_id;
 -- Disabled employees cannot continue using an already issued portal session.
 if not p_active then delete from auth.sessions where user_id in(
   select user_id from garments_access.app_user where employee_id=p_id);end if;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details)
 values(auth.uid(),case when p_active then 'Activated employee' else 'Deactivated employee' end,
   'employee',p_id::text,jsonb_build_object('is_active',p_active));
 return garments_access.employee_document(p_id);
end $$;
create function public.erp_set_employee_active(p_id bigint,p_active boolean,p_expected text) returns jsonb
language sql security invoker set search_path='' as $$select garments_access.set_employee_active(p_id,p_active,p_expected)$$;
revoke all on function garments_access.set_employee_active(bigint,boolean,text),public.erp_set_employee_active(bigint,boolean,text) from public,anon;
grant execute on function garments_access.set_employee_active(bigint,boolean,text),public.erp_set_employee_active(bigint,boolean,text) to authenticated;

-- Permission lookup for a selected verifier, separate from the operator's MFA
-- session. Never trusts caller-supplied employee identity or JWT user metadata.
create function garments_access.production_user_allowed(p_user uuid,p_action text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from garments_access.app_user u join garments_erp.employee e on e.id=u.employee_id
 join auth.users a on a.id=u.user_id
 join garments_access.app_user_role ur on ur.user_id=u.user_id
 join garments_access.app_role role on role.id=ur.role_id and role.is_active
 join garments_access.app_resource r on r.key='productionJobs' and garments_access.resource_available(r.id)
 left join garments_access.app_role_resource_permission p on p.app_role_id=role.id and p.app_resource_id=r.id
 where u.user_id=p_user and u.is_active and e.is_active and not u.must_change_password
 and a.deleted_at is null and (a.banned_until is null or a.banned_until<=now())
 and p_action in ('create','edit') and (not r.admin_only or role.is_system_admin)
 and (role.is_system_admin or (p.can_view and case when p_action='create' then p.can_create else p.can_edit end)));
$$;
create table garments_access.production_attestation (
 id uuid primary key default gen_random_uuid(),
 actor uuid not null references auth.users(id),
 verifier uuid not null references auth.users(id),
 verifier_session uuid not null references auth.sessions(id) on delete cascade,
 employee_id bigint not null references garments_erp.employee(id),
 payload_hash text not null,
 expires_at timestamptz not null default now()+interval '90 seconds',
 used_at timestamptz
);
alter table garments_access.production_attestation enable row level security;
revoke all on garments_access.production_attestation from public,anon,authenticated;
create index on garments_access.production_attestation(expires_at);

create function garments_access.attest_production(p_actor uuid,p_employee bigint,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare token uuid; operation text:=case when p_payload->>'action'='start' then 'create' else 'edit' end;
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>10000
   or p_payload->>'action' is null or p_payload->>'action' not in ('start','advance','rectify') then raise exception 'Invalid production command';end if;
 if not garments_access.production_user_allowed(auth.uid(),operation)
   or not garments_access.production_user_allowed(p_actor,operation)
   or not exists(select 1 from garments_access.app_user where user_id=auth.uid() and employee_id=p_employee)
   or not exists(select 1 from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id' and (not_after is null or not_after>now()))
   or not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) a
     where a->>'method'='password' and (a->>'timestamp')::numeric between extract(epoch from now())-90 and extract(epoch from now())+5)
   then raise exception 'An eligible selected employee must confirm their password' using errcode='42501';end if;
 insert into garments_access.production_attestation(actor,verifier,verifier_session,employee_id,payload_hash)
 values(p_actor,auth.uid(),(auth.jwt()->>'session_id')::uuid,p_employee,encode(extensions.digest(p_payload::text,'sha256'),'hex')) returning id into token;
 return token;
end $$;
create function public.erp_production_attestation(p_actor uuid,p_employee bigint,p_payload jsonb) returns uuid
language sql security invoker set search_path='' as $$select garments_access.attest_production(p_actor,p_employee,p_payload)$$;

-- Replay the movement sequence as a stack. Rectification truncates the current
-- route; subsequent advances append a fresh attempt, never a stale branch.
create function garments_access.production_path(p_production bigint) returns bigint[]
language plpgsql stable set search_path='' as $$
declare path bigint[]; movement record; position integer;
begin
 select array[from_job_id] into path from garments_erp.job_transition_log where production_id=p_production order by id limit 1;
 if path is null then return array(select id from garments_erp.job where production_id=p_production and latest);end if;
 for movement in select * from garments_erp.job_transition_log where production_id=p_production order by id loop
  if path[array_length(path,1)]<>movement.from_job_id then raise exception 'Production movement history is inconsistent';end if;
  if movement.action='advance' then path:=array_append(path,movement.to_job_id);
  else
   position:=array_position(path,movement.to_job_id);
   if position is null then raise exception 'Rectification destination is outside the current path';end if;
   path:=path[1:position];
  end if;
 end loop;
 return path;
end $$;

create function garments_access.move_production(p_payload jsonb,p_proof uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare action text:=p_payload->>'action'; pid bigint; source garments_erp.job; dest bigint;
 target_stage garments_erp.stage; current_stage garments_erp.stage; proof garments_access.production_attestation;
 path bigint[]; part bigint; handoff_source bigint; variant_count integer; item bigint;
 operation text:=case when action='start' then 'create' else 'edit' end;
begin
 -- A previous command in the same transaction may have flushed constraints.
 -- Allow the atomic switch to pass through zero current jobs, then validate
 -- again before returning from this guarded command.
 set constraints all deferred;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>10000
   or action is null or action not in ('start','advance','rectify') or exists(select 1 from jsonb_object_keys(p_payload) k
     where not k=any(array['action','production_id','item_part_id','from_job_id','to_job_id','to_stage_id','start_date','due_date','job_worker_id','item_status_list_id','reason']))
   then raise exception 'Invalid production command';end if;
 if not garments_access.has_screen_permission('productionJobs',operation)
   then raise exception 'Production write access required' using errcode='42501';end if;
 select * into proof from garments_access.production_attestation where id=p_proof for update;
 if not found or proof.actor<>auth.uid() or proof.expires_at<=now() or proof.used_at is not null
   or proof.payload_hash<>encode(extensions.digest(p_payload::text,'sha256'),'hex')
   or not garments_access.production_user_allowed(proof.verifier,operation)
   or not exists(select 1 from garments_access.app_user where user_id=proof.verifier and employee_id=proof.employee_id)
   or not exists(select 1 from auth.sessions where id=proof.verifier_session and user_id=proof.verifier and (not_after is null or not_after>now()))
   then raise exception 'Production verification expired or command changed. Verify again.' using errcode='42501';end if;
 if action='start' then
  part:=(p_payload->>'item_part_id')::bigint;
  perform 1 from garments_erp.item_part where id=part for update;
  if not found then raise exception 'Select an existing item part';end if;
  insert into garments_erp.production(item_part_id) values(part) returning id into pid;
  insert into garments_erp.task_board_data(production_id) values(pid);
  select * into target_stage from garments_erp.stage order by sort_order limit 1;
  if target_stage.id is null or (p_payload->>'to_stage_id')::bigint is distinct from target_stage.id
    then raise exception 'Production must start at the first stage';end if;
 else
  pid:=(p_payload->>'production_id')::bigint;
  select item_part_id into part from garments_erp.production where id=pid for update;
  if not found then raise exception 'Production does not exist';end if;
  select * into source from garments_erp.job where production_id=pid and latest for update;
  if source.id is null or source.id is distinct from (p_payload->>'from_job_id')::bigint
    then raise exception 'Current job changed. Reload before moving production.' using errcode='40001';end if;
  path:=garments_access.production_path(pid);
  select * into current_stage from garments_erp.stage where id=source.stage_id;
  if action='rectify' then
   dest:=(p_payload->>'to_job_id')::bigint;
   if dest is null or dest=source.id or not dest=any(path)
     then raise exception 'Select an earlier job on the current path';end if;
   if nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'Rectification requires a reason';end if;
   update garments_erp.job set latest=false where id=source.id;
   update garments_erp.job set latest=true,complete_date=null where id=dest and production_id=pid;
  else
   select * into target_stage from garments_erp.stage where sort_order>current_stage.sort_order order by sort_order limit 1;
   if target_stage.id is null or target_stage.id is distinct from (p_payload->>'to_stage_id')::bigint
     then raise exception 'Advance one stage at a time';end if;
   update garments_erp.job set latest=false,complete_date=coalesce(complete_date,current_date) where id=source.id;
  end if;
 end if;
 if action in ('start','advance') then
  insert into garments_erp.job(production_id,stage_id,job_code,start_date,due_date,job_worker_id,latest)
  values(pid,target_stage.id,garments_erp.generate_job_code(target_stage.id),
    coalesce((p_payload->>'start_date')::date,current_date),(p_payload->>'due_date')::date,
    (p_payload->>'job_worker_id')::bigint,true) returning id into dest;
  insert into garments_erp.job_item_status_list(job_id,date,item_status_list_id)
  values(dest,current_date,(p_payload->>'item_status_list_id')::bigint);
  insert into garments_erp.variant_item_per_job(job_id,variant_item_id)
  select dest,id from garments_erp.variant_item where item_part_id=part;
  if target_stage.track_pieces and not target_stage.pp_stage then
   select j.id into handoff_source from unnest(path) with ordinality route(jid,n)
   join garments_erp.job j on j.id=route.jid join garments_erp.stage s on s.id=j.stage_id
   where s.track_pieces and not s.pp_stage order by route.n desc limit 1;
   if handoff_source is not null then
    -- Only the actual source attempt supplies output; abandoned attempts are
    -- neither aggregated nor reused, and challans are never copied.
    insert into garments_erp.stage_pieces(variant_item_per_job_id,item_size_list_id,pieces_stock_in,pieces_stock_out)
    select nl.id,p.item_size_list_id,p.pieces_stock_out,0
    from garments_erp.variant_item_per_job oldlink join garments_erp.stage_pieces p on p.variant_item_per_job_id=oldlink.id
    join garments_erp.variant_item_per_job nl on nl.job_id=dest and nl.variant_item_id=oldlink.variant_item_id
    where oldlink.job_id=handoff_source;
   else
    -- First tracked stage: equal-share/largest-remainder allocation by variant
    -- ID, preserving each planned size total and the pilot share_weight=1 rule.
    select item_id into item from garments_erp.item_part where id=part;
    select count(*) into variant_count from garments_erp.variant_item_per_job where job_id=dest;
    if variant_count=0 then raise exception 'Tracked production requires at least one variant';end if;
    insert into garments_erp.stage_pieces(variant_item_per_job_id,item_size_list_id,pieces_stock_in,pieces_stock_out)
    select vl.id,sz.item_size_list_id,trunc(sz.pieces/variant_count)+case when vl.n<=mod(sz.pieces,variant_count) then 1 else 0 end,0
    from (select id,row_number() over(order by variant_item_id) n from garments_erp.variant_item_per_job where job_id=dest) vl
    cross join (select cr.item_size_list_id,cr.pieces from garments_erp.item_cut_ratio cr
      join garments_erp.item_size_list s on s.id=cr.item_size_list_id where s.item_id=item) sz;
   end if;
  end if;
 end if;
 if action<>'start' then
  insert into garments_erp.job_transition_log(production_id,from_job_id,to_job_id,action,verified_by,actor_user_id,reason)
  values(pid,source.id,dest,action,proof.employee_id,auth.uid(),p_payload->>'reason');
 end if;
 update garments_access.production_attestation set used_at=now() where id=p_proof;
 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details)
 values(auth.uid(),'Production '||action,'production',pid::text,jsonb_build_object('job_id',dest::text,'verified_by',proof.employee_id::text));
 -- Validate while still inside the guarded owner context, as Fabric commands
 -- already do. Browser roles deliberately have no direct table privileges.
 set constraints all immediate;
 return jsonb_build_object('production_id',pid::text,'job_id',dest::text,'current_path',
   (select jsonb_agg(x::text order by n) from unnest(garments_access.production_path(pid)) with ordinality a(x,n)),
   'stale_job_ids',(select coalesce(jsonb_agg(j.id::text order by j.id),'[]') from garments_erp.job j
     where j.production_id=pid and not j.id=any(garments_access.production_path(pid))));
end $$;
create function public.erp_move_production(p_payload jsonb,p_proof uuid) returns jsonb
language sql security invoker set search_path='' as $$select garments_access.move_production(p_payload,p_proof)$$;
revoke all on function garments_access.attest_production(uuid,bigint,jsonb),public.erp_production_attestation(uuid,bigint,jsonb),
 garments_access.move_production(jsonb,uuid),public.erp_move_production(jsonb,uuid) from public,anon;
grant execute on function garments_access.attest_production(uuid,bigint,jsonb),public.erp_production_attestation(uuid,bigint,jsonb),
 garments_access.move_production(jsonb,uuid),public.erp_move_production(jsonb,uuid) to authenticated;

-- Keep the existing RPC signature during the subsequent UI transition.
-- p_proof is deprecated and never supplies the actor.
create or replace function garments_access.save_employee(p_payload jsonb,p_proof uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare eid bigint:=nullif(p_payload->>'id','')::bigint; v bigint; row garments_erp.employee; proof garments_access.employee_attestation; d jsonb:=p_payload->'draft'; expected text:=p_payload->>'expected'; action text:=case when eid is null then 'create' else 'edit' end; e garments_erp.employee;
begin
 if not garments_access.has_screen_permission('employees',action) then raise exception 'Employee write access required' using errcode='42501';end if;
 if pg_column_size(p_payload)>100000 or jsonb_typeof(d)<>'object' then raise exception 'Invalid employee document';end if;
 if exists(select 1 from jsonb_object_keys(d) k where k<>'employee') or jsonb_typeof(d->'employee')<>'object'
 or exists(select 1 from jsonb_object_keys(d->'employee') k where not k=any(array['contacts_id','contact_purpose_id','contacts_emergency_id','contact_purpose_emergency_id','date_of_joining','date_of_birth','gender_id','blood_group_id','type_of_employment_id','employee_photo','supporting_document_1_title','supporting_document_2_title'])) then raise exception 'Unsupported employee field';end if;
 if nullif(d->'employee'->>'contacts_id','') is null or nullif(d->'employee'->>'contact_purpose_id','') is null then raise exception 'Select employee contact and purpose';end if;
 if nullif(d->'employee'->>'contact_purpose_emergency_id','') is not null and nullif(d->'employee'->>'contacts_emergency_id','') is null then raise exception 'Select an emergency contact before its purpose';end if;
 if eid is not null then
  select * into row from garments_erp.employee where id=eid for update;
  if not found then raise exception 'Employee no longer exists';end if;
  if md5(garments_access.employee_document(eid)::text) is distinct from expected then raise exception 'Employee changed. Reload before saving.' using errcode='40001';end if;
 end if;
 select employee_id into v from garments_access.app_user where user_id=auth.uid();
 if v is null then raise exception 'An operator employee link is required' using errcode='42501';end if;
 select * into e from jsonb_populate_record(null::garments_erp.employee,(select jsonb_object_agg(k,case when val='""'::jsonb then 'null'::jsonb else val end) from jsonb_each(d->'employee') x(k,val)));
 if e.date_of_birth>current_date then raise exception 'Date of birth cannot be in the future';end if;
 if eid is null then
  insert into garments_erp.employee(contacts_id,contact_purpose_id) values(e.contacts_id,e.contact_purpose_id) returning id into eid;
 end if;
 update garments_erp.employee set contacts_id=e.contacts_id,contact_purpose_id=e.contact_purpose_id,contacts_emergency_id=e.contacts_emergency_id,contact_purpose_emergency_id=e.contact_purpose_emergency_id,
 date_of_joining=e.date_of_joining,date_of_birth=e.date_of_birth,gender_id=e.gender_id,blood_group_id=e.blood_group_id,type_of_employment_id=e.type_of_employment_id,employee_photo=e.employee_photo,
 supporting_document_1_title=e.supporting_document_1_title,supporting_document_2_title=e.supporting_document_2_title,verified_by_employee_id=v,is_verified=true where id=eid;


 insert into garments_access.app_activity_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'Saved employee','employee',eid::text,jsonb_build_object('verified_by_employee_id',v::text));
 return garments_access.employee_snapshot();
end $$;


CREATE OR REPLACE FUNCTION garments_erp.check_lab_dip_traceability()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if exists(select 1 from garments_erp.dyed_fabric_item d left join garments_erp.batch_no_lab_dip_version_map b on b.dyed_fabric_item_id=d.id where b.id is null) then raise exception 'Every dyed-fabric item requires one batch mapping';end if;
 if exists(select 1 from garments_erp.batch_no_lab_dip_version_map b join garments_erp.dyed_fabric_item d on d.id=b.dyed_fabric_item_id join garments_erp.dyeing_program_item i on i.id=d.dyeing_program_item_id where i.lab_dip_version_id<>b.lab_dip_version_id) then raise exception 'Batch and originating program must reference the same lab-dip version';end if;
 if exists(select 1 from garments_erp.dyeing_program_item i join garments_erp.dyeing_program p on p.id=i.dyeing_program_id join garments_erp.lab_dip_version v on v.id=i.lab_dip_version_id join garments_erp.lab_dip l on l.id=v.lab_dip_id where p.dyer_id is distinct from l.dyer_id) then raise exception 'Lab-dip dyer must match the program dyer';end if;
 if exists(select 1 from garments_erp.dyeing_program_item i join garments_erp.batch_no_lab_dip_version_map b on b.id=i.batch_no where i.lab_dip_version_id<>b.lab_dip_version_id) then raise exception 'Previous batch must use the selected lab-dip version';end if;
 if exists(select 1 from garments_erp.dyeing_program_item i join garments_erp.batch_no_lab_dip_version_map b on b.id=i.batch_no join garments_erp.dyed_fabric_item d on d.id=b.dyed_fabric_item_id where d.dyeing_program_item_id=i.id) then raise exception 'A program cannot use its own output as a previous batch';end if;
 if exists(select 1 from garments_erp.variant_item vi join garments_erp.item_part ip on ip.id=vi.item_part_id join garments_erp.item it on it.id=ip.item_id join garments_erp.lab_dip l on l.id=vi.lab_dip_id join garments_erp.color_map_by_brand cm on cm.id=l.color_map_by_brand_id where it.brand_id is distinct from cm.brand_list_id) then raise exception 'Selected lab dip must match the item brand';end if;
 return null;
end$function$
;

create or replace function garments_access.employee_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not garments_access.has_screen_permission('employees','view') then raise exception 'Employee access required' using errcode='42501';end if;
 result:=jsonb_build_object('records',(select coalesce(jsonb_agg(garments_access.employee_document(e.id)||jsonb_build_object('revision',md5(garments_access.employee_document(e.id)::text)) order by e.id),'[]') from garments_erp.employee e),
 'contact_choices',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id::text,'company_name',c.company_name) order by c.id),'[]') from garments_erp.contacts c),
 'verifiers',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'name',c.company_name,'code',e.employee_code,'email',a.email)),'[]') from garments_erp.employee e join garments_access.app_user u on u.employee_id=e.id and u.is_active and not u.must_change_password join auth.users a on a.id=u.user_id join garments_erp.contacts c on c.id=e.contacts_id where a.email is not null and e.is_active and u.user_id=auth.uid()));
 result:=result||jsonb_build_object(
 'gender',(select coalesce(jsonb_agg(garments_access.fabric_json('gender',to_jsonb(x)) order by x.id),'[]'::jsonb) from garments_erp.gender x),
 'blood_group',(select coalesce(jsonb_agg(garments_access.fabric_json('blood_group',to_jsonb(x)) order by x.id),'[]'::jsonb) from garments_erp.blood_group x),
 'type_of_employment',(select coalesce(jsonb_agg(garments_access.fabric_json('type_of_employment',to_jsonb(x)) order by x.id),'[]'::jsonb) from garments_erp.type_of_employment x),
 'contact_purpose',(select coalesce(jsonb_agg(garments_access.fabric_json('contact_purpose',to_jsonb(x)) order by x.id),'[]'::jsonb) from garments_erp.contact_purpose x));
 return result;
end $$;

-- Compatibility JSON derives review fields; the version table has none.
create or replace function garments_access.fabric_json(p_table text,p_row jsonb) returns jsonb
language plpgsql stable set search_path='' as $body$
declare c record; result jsonb:=p_row;
begin
 for c in select a.attname from pg_catalog.pg_attribute a where a.attrelid=pg_catalog.to_regclass('garments_erp.'||p_table) and a.atttypid='pg_catalog.int8'::pg_catalog.regtype and a.attnum>0 and not a.attisdropped loop
  if result->c.attname is not null and result->c.attname<>'null'::jsonb then result:=jsonb_set(result,array[c.attname],to_jsonb(result->>c.attname));end if;
 end loop;
 if p_table='lab_dip_version' then
  result:=result||coalesce((select jsonb_build_object('date',i.date,'comments',i.comments,'lab_dip_status_id',i.lab_dip_status_id::text)
   from garments_erp.lab_dip_version_item i where i.lab_dip_version_id=(p_row->>'id')::bigint and i.latest),
   jsonb_build_object('date',null,'comments',null,'lab_dip_status_id',null));
 end if;
 return result;
end $body$;

create or replace function garments_access.save_fabric_document(p_resource text,p_root jsonb,p_action text,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $body$
declare contract jsonb:=garments_access.fabric_contract(); root_table text:=p_root->>'table'; root_id text:=p_root->>'id'; original_root text:=p_root->>'id'; change jsonb; t text; rid text; vals jsonb; oldrow jsonb; actual jsonb; fields jsonb; col text; columns_sql text; select_sql text; assignments text; created_id text; mapped jsonb:='{}'; entry record; delete_pass boolean; root_expected jsonb:=p_root->'before'; root_actual jsonb; permitted_roots text[]; changed_dyed text[]; changed_program text[]; review jsonb; review_job bigint; review_changed boolean;
begin
 if p_action not in ('create','edit') or not (contract ? p_resource) or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>500 or jsonb_array_length(p_changes)=0 then raise exception 'Invalid Fabric command';end if;
 if not garments_access.has_screen_permission(p_resource,p_action) then raise exception 'This account cannot save this record' using errcode='42501';end if;
 permitted_roots:=case p_resource when 'suppliers' then array['yarn_supplier','knitter','dyer'] when 'labDips' then array['lab_dip'] when 'orders' then array['yarn_purchase_order'] when 'yarn' then array['yarn_bill'] when 'knitting' then array['knitting_bill'] when 'programs' then array['dyeing_program'] when 'dyeBills' then array['dyed_fabric_bill'] else array(select jsonb_object_keys(contract->p_resource)) end;
 if not root_table=any(permitted_roots) or root_id is null then raise exception 'Invalid document scope';end if;
 -- All portal Fabric writers serialize; source-balance checks and multi-row writes are atomic.
 perform pg_catalog.pg_advisory_xact_lock(741208531);
 if p_action='edit' then
  if root_id!~'^[0-9]+$' then raise exception 'Invalid record identity';end if;
  execute format('select to_jsonb(x) from garments_erp.%I x where id=$1::bigint for update',root_table) into root_actual using root_id;
  if root_actual is null or garments_access.fabric_json(root_table,root_actual) is distinct from root_expected then raise exception 'This document changed. Reload and review it again.' using errcode='40001';end if;
 elsif root_id!~'^[0-9a-f-]{36}$' then raise exception 'New records require a temporary identity';end if;
 if exists(select 1 from jsonb_array_elements(p_changes) c where jsonb_typeof(c)<>'object' or not (c ?& array['table','id','before','values']) or c->>'id' is null or c->>'table' is null) then raise exception 'Malformed document change';end if;
 -- Updates/inserts in client contract dependency order. Deletes run in reverse afterwards.
 foreach delete_pass in array array[false,true] loop
 for change in select value from jsonb_array_elements(p_changes) with ordinality c(value,n) where (value->'values'='null'::jsonb)=delete_pass order by case when delete_pass then -n else n end loop
  t:=change->>'table';rid:=change->>'id';oldrow:=change->'before';vals:=change->'values';fields:=contract->p_resource->t;
  if fields is null then raise exception 'Table is outside this screen';end if;
  if vals<>'null'::jsonb then
   if jsonb_typeof(vals)<>'object' or exists(select 1 from jsonb_object_keys(vals) k where not fields ? k) then raise exception 'Field is outside the writable contract';end if;
   for entry in select key,value from jsonb_each_text(vals) loop
    if mapped ? entry.value then vals:=jsonb_set(vals,array[entry.key],mapped->entry.value);end if;
   end loop;
   for entry in select e.key,e.value from jsonb_each_text(vals) e join information_schema.columns c on c.table_schema='garments_erp' and c.table_name=t and c.column_name=e.key where c.data_type in ('numeric','integer') and e.value is not null loop if entry.value::numeric<0 then raise exception 'Quantities, weights and rates cannot be negative';end if;end loop;
   if t='lab_dip_version' and coalesce((vals->>'attached_swatch')::boolean,false) then vals:=vals||jsonb_build_object('shade_card_no',null,'shade_card_option',null,'lab_dip_status_id',(select id::text from garments_erp.lab_dip_version_status where sort_order=4));end if;
  end if;
  review:=null;review_changed:=false;
  if t='lab_dip_version' and not delete_pass then
   review:=jsonb_build_object('date',vals->'date','comments',vals->'comments','lab_dip_status_id',vals->'lab_dip_status_id');
   review_changed:=oldrow='null'::jsonb or row(oldrow->'date',oldrow->'comments',oldrow->'lab_dip_status_id')
     is distinct from row(review->'date',review->'comments',review->'lab_dip_status_id');
   vals:=vals-array['date','comments','lab_dip_status_id'];
  end if;
  if oldrow<>'null'::jsonb then
   if rid!~'^[0-9]+$' then raise exception 'Invalid existing identity';end if;
   execute format('select to_jsonb(x) from garments_erp.%I x where id=$1::bigint for update',t) into actual using rid;
   if actual is null or garments_access.fabric_json(t,actual) is distinct from oldrow then raise exception 'A linked record changed. Reload and review again.' using errcode='40001';end if;
   if not garments_access.fabric_row_in_document(t,actual,root_table,root_id) then raise exception 'Record belongs to another document';end if;
   if t='contacts' then raise exception 'Edit existing shared company details from Contacts';end if;
   if delete_pass then
    if t=root_table or t=any(array['contacts','lab_dip','lab_dip_version']) then raise exception 'This record cannot be removed here';end if;
    execute format('delete from garments_erp.%I where id=$1::bigint',t) using rid;
   else
    if not garments_access.fabric_row_in_document(t,vals||jsonb_build_object('id',rid),root_table,root_id) then raise exception 'Cannot move a row between documents';end if;
    select string_agg(format('%I=v.%I',key,key),',') into assignments from jsonb_object_keys(vals) key;
    execute format('update garments_erp.%I x set %s from jsonb_populate_record(null::garments_erp.%I,$1) v where x.id=$2::bigint',t,assignments,t) using vals,rid;
   end if;
  else
   if mapped ? rid then raise exception 'Duplicate temporary identity';end if;
   if delete_pass or rid!~'^[0-9a-f-]{36}$' then raise exception 'Invalid new record';end if;
   if not garments_access.fabric_row_in_document(t,vals||jsonb_build_object('id',rid),root_table,case when t=root_table then original_root else root_id end) then raise exception 'New row is outside the document';end if;
   select string_agg(format('%I',key),','),string_agg(format('v.%I',key),',') into columns_sql,select_sql from jsonb_object_keys(vals) key;
   execute format('insert into garments_erp.%I (%s) select %s from jsonb_populate_record(null::garments_erp.%I,$1) v returning id::text',t,columns_sql,select_sql,t) into created_id using vals;
   mapped:=mapped||jsonb_build_object(rid,created_id);if t=root_table then root_id:=created_id;end if;
  end if;
  if review_changed then
   review_job:=coalesce(mapped->>rid,rid)::bigint;
   insert into garments_erp.lab_dip_version_item(lab_dip_version_id,date,comments,lab_dip_status_id)
   values(review_job,(review->>'date')::date,review->>'comments',(review->>'lab_dip_status_id')::bigint);
  end if;
 end loop;
 end loop;
 if p_action='create' and not (mapped ? original_root) then raise exception 'The new document header is missing';end if;
 if p_resource='suppliers' then
  for change in select value from jsonb_array_elements(p_changes) where value->>'table'='contacts' loop
   if not exists(select 1 from jsonb_array_elements(p_changes) r where r->>'table'=root_table and r->'values'->>'contacts_id'=change->>'id') then raise exception 'New company must be assigned to this supplier';end if;
  end loop;
 end if;
 execute format('update garments_erp.%I set updated_at=clock_timestamp() where id=$1::bigint',root_table) using root_id;
 if root_table=any(array['yarn_purchase_order','yarn_bill','knitting_bill','dyeing_program','dyed_fabric_bill','lab_dip']) then
  t:=case root_table when 'yarn_purchase_order' then 'yarn_purchase_order_item' when 'yarn_bill' then 'yarn_bill_item' when 'knitting_bill' then 'knitting_bill_item' when 'dyeing_program' then 'dyeing_program_item' when 'dyed_fabric_bill' then 'dyed_fabric_item' else 'lab_dip_version' end;
  col:=case root_table when 'yarn_purchase_order' then 'purchase_order_number_id' else root_table||'_id' end;
  execute format('select to_jsonb(count(*)) from garments_erp.%I where %I=$1::bigint',t,col) into actual using root_id;
  if actual='0'::jsonb then raise exception 'A document must contain at least one line or version';end if;
 end if;
 -- Weight gain and shortage are allowed. Only source identity/type compatibility is checked.
 select coalesce(array_agg(distinct ref) filter(where ref is not null),array[]::text[]) into changed_dyed from (select coalesce(mapped->>(c->>'id'),c->>'id') ref from jsonb_array_elements(p_changes) c where c->>'table'='dyed_fabric_item' and c->'values'<>'null'::jsonb and exists(select 1 from unnest(array['billed_quantity','gross_quantity','final_quantity','knitting_bill_item_id','dyeing_program_item_id']) f where c->'before'->f is distinct from c->'values'->f)) q;
 select coalesce(array_agg(distinct ref) filter(where ref is not null),array[]::text[]) into changed_program from (select coalesce(mapped->>(c->>'id'),c->>'id') ref from jsonb_array_elements(p_changes) c where c->>'table'='dyeing_program_item' and c->'values'<>'null'::jsonb and exists(select 1 from unnest(array['fabric_type_id']) f where c->'before'->f is distinct from c->'values'->f)) q;
 if exists(select 1 from garments_erp.dyed_fabric_item d join garments_erp.dyeing_program_item p on p.id=d.dyeing_program_item_id join garments_erp.knitting_bill_item k on k.id=d.knitting_bill_item_id where (d.id::text=any(changed_dyed) or p.id::text=any(changed_program)) and p.fabric_type_id<>k.fabric_type_id) then raise exception 'The changed dyeing program fabric type does not match its knitted source.';end if;
 set constraints all immediate;
 insert into garments_access.app_activity_log(actor_user_id,app_resource_id,action,target_type,target_id,details)
 values(auth.uid(),(select id from garments_access.app_resource where key=p_resource),'Saved '||p_action||' document',root_table,root_id,jsonb_build_object('screen',p_resource,'changed_rows',jsonb_array_length(p_changes)));
 return garments_access.fabric_snapshot();
end $body$;
-- New review API writes the owning child table, with an optimistic latest-review
-- check. The legacy Fabric API above is only an adapter over this same storage.
create function garments_access.add_lab_dip_review(p_version bigint,p_status bigint,p_date date,p_comments text,p_expected_review bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare parent bigint; actual bigint; swatch boolean;
begin
 if not garments_access.has_screen_permission('labDips','edit') then raise exception 'Lab Dip write access required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(741208531);
 select lab_dip_id into strict parent from garments_erp.lab_dip_version where id=p_version;
 perform 1 from garments_erp.lab_dip where id=parent for update;
 select id into actual from garments_erp.lab_dip_version_item where lab_dip_version_id=p_version and latest;
 if actual is distinct from p_expected_review then raise exception 'Review changed. Reload before saving.' using errcode='40001';end if;
 select sort_order=4 into swatch from garments_erp.lab_dip_version_status where id=p_status;
 if swatch is null then raise exception 'Select a Lab Dip status';end if;
 update garments_erp.lab_dip_version set attached_swatch=swatch where id=p_version;
 insert into garments_erp.lab_dip_version_item(lab_dip_version_id,lab_dip_status_id,date,comments)
 values(p_version,p_status,p_date,p_comments);
 set constraints all immediate;
 return garments_access.fabric_snapshot();
end $$;
create function public.erp_add_lab_dip_review(p_version bigint,p_status bigint,p_date date,p_comments text,p_expected_review bigint) returns jsonb
language sql security invoker set search_path='' as $$select garments_access.add_lab_dip_review(p_version,p_status,p_date,p_comments,p_expected_review)$$;
revoke all on function garments_access.add_lab_dip_review(bigint,bigint,date,text,bigint),public.erp_add_lab_dip_review(bigint,bigint,date,text,bigint) from public,anon;
grant execute on function garments_access.add_lab_dip_review(bigint,bigint,date,text,bigint),public.erp_add_lab_dip_review(bigint,bigint,date,text,bigint) to authenticated;

create function garments_access.production_document(p_id bigint) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('production',garments_access.fabric_json('production',to_jsonb(p)),
 'item_part',garments_access.fabric_json('item_part',to_jsonb(ip)),
 'item',garments_access.fabric_json('item',to_jsonb(it)),
 'board',garments_access.fabric_json('task_board_data',to_jsonb(b)),
 'jobs',(select coalesce(jsonb_agg(garments_access.fabric_json('job',to_jsonb(j)) order by j.id),'[]') from garments_erp.job j where j.production_id=p.id),
 'statuses',(select coalesce(jsonb_agg(garments_access.fabric_json('job_item_status_list',to_jsonb(s)) order by s.id),'[]')
   from garments_erp.job_item_status_list s join garments_erp.job j on j.id=s.job_id where j.production_id=p.id),
 'assignees',(select coalesce(jsonb_agg(a.assigned_employees_id::text order by a.assigned_employees_id),'[]') from garments_erp.job_assignees a where a.production_id=p.id),
 'flags',(select coalesce(jsonb_agg(f.task_board_data_flag_id::text order by f.task_board_data_flag_id),'[]') from garments_erp.task_board_data_flag f where f.task_board_data_id=b.id),
 'movements',(select coalesce(jsonb_agg(garments_access.fabric_json('job_transition_log',to_jsonb(l)) order by l.id),'[]') from garments_erp.job_transition_log l where l.production_id=p.id),
 'current_path',(select coalesce(jsonb_agg(x::text order by n),'[]') from unnest(garments_access.production_path(p.id)) with ordinality a(x,n)))
 from garments_erp.production p join garments_erp.item_part ip on ip.id=p.item_part_id
 join garments_erp.item it on it.id=ip.item_id join garments_erp.task_board_data b on b.production_id=p.id where p.id=p_id;
$$;
create function garments_access.production_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not garments_access.has_screen_permission('productionJobs','view') then raise exception 'Production access required' using errcode='42501';end if;
 return jsonb_build_object('records',(select coalesce(jsonb_agg(garments_access.production_document(p.id)||jsonb_build_object('revision',md5(garments_access.production_document(p.id)::text)) order by p.id),'[]') from garments_erp.production p),
 'stages',(select coalesce(jsonb_agg(garments_access.fabric_json('stage',to_jsonb(s)) order by sort_order),'[]') from garments_erp.stage s),
 'statuses',(select coalesce(jsonb_agg(garments_access.fabric_json('item_status_list',to_jsonb(s)) order by id),'[]') from garments_erp.item_status_list s),
 'flags',(select coalesce(jsonb_agg(garments_access.fabric_json('flags_list',to_jsonb(f)) order by id),'[]') from garments_erp.flags_list f),
 'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'name',c.company_name,'code',e.employee_code) order by e.id),'[]')
   from garments_erp.employee e join garments_erp.contacts c on c.id=e.contacts_id where e.is_active),
 'verifiers',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'name',c.company_name,'email',a.email) order by e.id),'[]')
   from garments_erp.employee e join garments_erp.contacts c on c.id=e.contacts_id
   join garments_access.app_user u on u.employee_id=e.id join auth.users a on a.id=u.user_id
   where garments_access.production_user_allowed(u.user_id,'edit')));
end $$;
create function public.erp_production_snapshot() returns jsonb
language sql stable security invoker set search_path='' as $$select garments_access.production_snapshot()$$;
revoke all on function garments_access.production_snapshot(),public.erp_production_snapshot() from public,anon;
grant execute on function garments_access.production_snapshot(),public.erp_production_snapshot() to authenticated;

create function garments_access.save_production_board(p_id bigint,p_expected text,p_assignees bigint[],p_flags bigint[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare bid bigint;
begin
 if not garments_access.has_screen_permission('productionJobs','edit') then raise exception 'Production write access required' using errcode='42501';end if;
 perform 1 from garments_erp.production where id=p_id for update;
 if not found or md5(garments_access.production_document(p_id)::text) is distinct from p_expected
   then raise exception 'Production changed. Reload before saving.' using errcode='40001';end if;
 if p_assignees is null or p_flags is null or cardinality(p_assignees)>100 or cardinality(p_flags)>100
   or exists(select 1 from unnest(p_assignees) x where x is null or not exists(select 1 from garments_erp.employee where id=x and is_active))
   then raise exception 'Select active employees and valid flags';end if;
 select id into strict bid from garments_erp.task_board_data where production_id=p_id;
 delete from garments_erp.job_assignees where production_id=p_id and not assigned_employees_id=any(p_assignees);
 insert into garments_erp.job_assignees(production_id,assigned_employees_id)
 select distinct p_id,x from unnest(p_assignees) x on conflict(production_id,assigned_employees_id) do nothing;
 delete from garments_erp.task_board_data_flag where task_board_data_id=bid and not task_board_data_flag_id=any(p_flags);
 insert into garments_erp.task_board_data_flag(task_board_data_id,task_board_data_flag_id)
 select distinct bid,x from unnest(p_flags) x on conflict(task_board_data_id,task_board_data_flag_id) do nothing;
 return garments_access.production_snapshot();
end $$;
create function public.erp_save_production_board(p_id bigint,p_expected text,p_assignees bigint[],p_flags bigint[]) returns jsonb
language sql security invoker set search_path='' as $$select garments_access.save_production_board(p_id,p_expected,p_assignees,p_flags)$$;
revoke all on function garments_access.save_production_board(bigint,text,bigint[],bigint[]),public.erp_save_production_board(bigint,text,bigint[],bigint[]) from public,anon;
grant execute on function garments_access.save_production_board(bigint,text,bigint[],bigint[]),public.erp_save_production_board(bigint,text,bigint[],bigint[]) to authenticated;

create function garments_access.save_job_status(p_job bigint,p_status bigint,p_date date,p_expected timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pid bigint; changed integer;
begin
 if not garments_access.has_screen_permission('productionJobs','edit') then raise exception 'Production write access required' using errcode='42501';end if;
 select production_id into pid from garments_erp.job where id=p_job;
 perform 1 from garments_erp.production where id=pid for update;
 if not exists(select 1 from garments_erp.job where id=p_job and latest) then raise exception 'Only the current job status can be edited';end if;
 update garments_erp.job_item_status_list set item_status_list_id=p_status,date=p_date
 where job_id=p_job and updated_at is not distinct from p_expected;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Job status changed. Reload before saving.' using errcode='40001';end if;
 set constraints all immediate;
 return garments_access.production_snapshot();
end $$;
create function public.erp_save_job_status(p_job bigint,p_status bigint,p_date date,p_expected timestamptz) returns jsonb
language sql security invoker set search_path='' as $$select garments_access.save_job_status(p_job,p_status,p_date,p_expected)$$;
revoke all on function garments_access.save_job_status(bigint,bigint,date,timestamptz),public.erp_save_job_status(bigint,bigint,date,timestamptz) from public,anon;
grant execute on function garments_access.save_job_status(bigint,bigint,date,timestamptz),public.erp_save_job_status(bigint,bigint,date,timestamptz) to authenticated;

create function garments_erp.protect_job_transition_log() returns trigger
language plpgsql set search_path='' as $$
begin
 raise exception 'Production transitions are immutable';
end $$;
create trigger protect_job_transition_log before update or delete on garments_erp.job_transition_log
for each row execute function garments_erp.protect_job_transition_log();

-- Private helpers are never callable through PostgREST or a browser role.
revoke all on function garments_erp.check_production_hub(),garments_erp.check_job_status_row(),
 garments_erp.keep_production_identity(),garments_erp.guard_lab_dip_version_item(),garments_erp.protect_lab_dip_review(),
 garments_erp.protect_job_transition_log(),garments_access.stamp_employee_operator(),
 garments_access.production_user_allowed(uuid,text),garments_access.production_path(bigint),
 garments_access.production_document(bigint) from public,anon,authenticated;

-- Account state must agree with HR state, including stale tokens after a
-- deactivation. Reactivation does not override an administrator-disabled login.
create or replace function garments_access.account_security() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',coalesce(u.is_active and e.is_active,false),
  'mustChangePassword',coalesce(u.must_change_password,false),'ready',garments_access.session_ready())
 from (select auth.uid() as id) a left join garments_access.app_user u on u.user_id=a.id
 left join garments_erp.employee e on e.id=u.employee_id where a.id is not null;
$$;

-- Prevent moving an editable status row away from its job.
create function garments_erp.keep_job_status_identity() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.job_id<>old.job_id then raise exception 'A status row cannot be moved between jobs';end if;
 return new;
end $$;
create trigger keep_job_status_identity before update on garments_erp.job_item_status_list
for each row execute function garments_erp.keep_job_status_identity();
revoke all on function garments_erp.keep_job_status_identity() from public,anon,authenticated;

-- Register the new ownership in the access catalogue without granting any role
-- new permissions or enabling direct-table access.
insert into garments_access.app_db_table(schema_name,table_name)
select 'garments_erp',t from unnest(array['production','task_board_data','flags_list','task_board_data_flag','job_item_status_list','job_transition_log','lab_dip_version_item']) t
on conflict(schema_name,table_name) do nothing;
delete from garments_access.app_resource_table m using garments_access.app_db_table t
where t.id=m.app_db_table_id and t.schema_name='garments_erp' and t.table_name='job_status_history';
delete from garments_access.app_db_table where schema_name='garments_erp' and table_name='job_status_history';
insert into garments_access.app_resource_table(app_resource_id,app_db_table_id,relation_type,can_view,can_create,can_edit,can_delete)
select r.id,t.id,'primary',true,true,true,false from garments_access.app_resource r
join garments_access.app_db_table t on t.schema_name='garments_erp'
 and t.table_name=any(array['production','task_board_data','task_board_data_flag','job_item_status_list'])
where r.key='productionJobs'
on conflict(app_resource_id,app_db_table_id) do nothing;
insert into garments_access.app_resource_table(app_resource_id,app_db_table_id,relation_type,can_view,can_create,can_edit,can_delete)
select r.id,t.id,'lookup',true,false,false,false from garments_access.app_resource r
join garments_access.app_db_table t on t.schema_name='garments_erp' and t.table_name=any(array['flags_list','job_transition_log'])
where r.key='productionJobs'
on conflict(app_resource_id,app_db_table_id) do nothing;

commit;
