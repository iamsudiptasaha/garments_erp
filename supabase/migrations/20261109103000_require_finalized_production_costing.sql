begin;

set local lock_timeout = '10s';

create function garments_erp.guard_production_costing()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Serialize competing receipts even when invoked outside the stock RPC.
  perform id from garments_erp.item where id = new.item_id for update;
  if exists (select 1 from garments_erp.item_produced where item_id = new.item_id) then
    raise exception 'Production is already finalized for this item. Use Stock adjustments.';
  end if;
  if not exists (
    select 1 from garments_erp.item_costing c
    join garments_erp.item_costing_status s on s.id = c.item_costing_status_id
    where c.item_id = new.item_id and s.name = 'finalized'
  ) then
    raise exception 'Complete item costing to finalize production pieces';
  end if;
  if not exists (
    select 1 from garments_erp.job j
    join garments_erp.production p on p.id = j.production_id
    join garments_erp.item_part ip on ip.id = p.item_part_id
    join garments_erp.stage st on st.id = j.stage_id
    join garments_erp.stage_type typ on typ.id = st.stage_type_id
    where j.id = new.completed_job_id and ip.item_id = new.item_id and j.latest
      and lower(typ.name) = 'complete'
  ) then
    raise exception 'Select a current job whose stage type is Complete';
  end if;
  return new;
end;
$$;

revoke all on function garments_erp.guard_production_costing()
  from public, anon, authenticated, service_role;

create trigger require_production_costing before insert on garments_erp.item_produced
for each row execute function garments_erp.guard_production_costing();

create or replace function garments_erp.guard_item_costing()
returns trigger language plpgsql set search_path = '' as $$
declare
  status_name text;
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1
     and old.item_produced_id is null and new.item_produced_id is not null
     and (to_jsonb(new) - 'item_produced_id') = (to_jsonb(old) - 'item_produced_id') then
    return new;
  end if;
  if tg_op <> 'INSERT' and exists (
    select 1 from garments_erp.item_costing_status
    where id = old.item_costing_status_id and name = 'finalized'
  ) then
    raise exception 'Finalized costing is immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.id, new.item_id, new.version)
      is distinct from (old.id, old.item_id, old.version) then
    raise exception 'Costing identity is immutable';
  end if;

  select name into strict status_name from garments_erp.item_costing_status
    where id = new.item_costing_status_id;
  if status_name = 'finalized' then
    if tg_op = 'INSERT' or auth.uid() is null or coalesce(new.completed_units, 0) <= 0
      or not exists (
        select 1 from garments_erp.item_costing_item where item_costing_id = new.id
      ) or exists (
        select 1 from garments_erp.item_costing_item
        where item_costing_id = new.id and approved_amount is null
      ) then
      raise exception 'Finalization requires an authenticated approver, positive completed units and approved line amounts';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := clock_timestamp();
  else
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end;
$$;

create function garments_erp.link_production_costing()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update garments_erp.item_costing set item_produced_id = new.id
    where item_id = new.item_id and item_produced_id is null;
  return new;
end;
$$;

revoke all on function garments_erp.link_production_costing()
  from public, anon, authenticated, service_role;

create trigger link_production_costing after insert on garments_erp.item_produced
for each row execute function garments_erp.link_production_costing();

commit;
