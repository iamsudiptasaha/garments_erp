begin;
set local lock_timeout = '10s';

alter table garments_erp.item add column is_locked boolean not null default false;
alter table garments_erp.item_produced
  add column completed_job_id bigint not null references garments_erp.job(id),
  add column verified_by bigint not null references garments_erp.employee(id),
  add column verified_at timestamptz not null default now(),
  add column request_id uuid not null unique,
  drop column item_in_store_id;
alter table garments_erp.item_produced_pieces
  add constraint finished_whole_pieces check (pieces >= 0 and pieces <= 2147483647 and pieces = trunc(pieces));
alter table garments_erp.item_produced_pieces alter column pieces type integer;

alter table garments_erp.item_in_store add column is_active boolean not null default true;
alter table garments_erp.item_in_store_variation
  add column is_active boolean not null default true,
  add column verified_by_employee_id bigint references garments_erp.employee(id),
  add column verified_at timestamptz,
  add constraint finished_variation_verification_pair
    check ((verified_by_employee_id is null) = (verified_at is null));
alter table garments_erp.item_size_list add unique (item_id, id);
alter table garments_erp.sellable_unit
  add column item_id bigint,
  add constraint finished_whole_weight check (share_weight > 0 and share_weight <= 2147483647 and share_weight = trunc(share_weight));
update garments_erp.sellable_unit u set item_id = s.item_id
from garments_erp.item_size_list s where s.id = u.item_size_list_id;
alter table garments_erp.sellable_unit
  alter column item_id set not null,
  alter column share_weight set not null,
  add foreign key (item_id, item_size_list_id) references garments_erp.item_size_list(item_id, id);
alter table garments_erp.sellable_unit alter column share_weight type integer;

create table garments_erp.stock_adjustment (
  id bigint generated always as identity primary key,
  item_id bigint not null,
  item_size_list_id bigint not null,
  quantity_delta integer not null,
  reason text not null check (btrim(reason) <> ''),
  verified_by bigint not null references garments_erp.employee(id),
  verified_at timestamptz not null default now(),
  request_id uuid not null unique,
  foreign key (item_id, item_size_list_id) references garments_erp.item_size_list(item_id, id)
);
alter table garments_erp.stock_adjustment enable row level security;
revoke all on garments_erp.stock_adjustment from public, anon, authenticated;
create index on garments_erp.stock_adjustment (item_size_list_id);
create index on garments_erp.item_produced (item_id);
create index on garments_erp.item_produced_pieces (item_size_list_id);

-- RESTRICT is intentional. Unknown dependencies must stop the migration.
do $$
begin
  if exists (select 1 from garments_erp.view_item_in_stock)
     or exists (select 1 from garments_erp.item_sold) then
    raise exception 'Review legacy stock records before removing their tables';
  end if;
end;
$$;
drop table garments_erp.view_item_in_stock;
drop table garments_erp.item_sold;
delete from garments_access.app_resource_table m using garments_access.app_db_table t
where m.app_db_table_id = t.id and t.schema_name = 'garments_erp'
  and t.table_name in ('view_item_in_stock', 'item_sold');
delete from garments_access.app_db_table
where schema_name = 'garments_erp' and table_name in ('view_item_in_stock', 'item_sold');

insert into garments_access.app_resource (key, name, resource_type)
values ('finishedProducts', 'Finished Products', 'screen');
insert into garments_access.app_db_table (schema_name, table_name)
values ('garments_erp', 'stock_adjustment');

create function garments_access.reject_finished_edit() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Verified finished stock records are immutable';
end;
$$;
create trigger immutable_finished_stock before update or delete on garments_erp.item_produced
for each row execute function garments_access.reject_finished_edit();
create trigger immutable_finished_pieces before update or delete on garments_erp.item_produced_pieces
for each row execute function garments_access.reject_finished_edit();
create trigger immutable_finished_adjustment before update or delete on garments_erp.stock_adjustment
for each row execute function garments_access.reject_finished_edit();

create function garments_access.guard_finished_item() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.is_locked then
    raise exception 'Verified manufactured items are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_finished_item before update or delete on garments_erp.item
for each row execute function garments_access.guard_finished_item();

create function garments_access.guard_finished_item_child() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_parent bigint;
  new_parent bigint;
  parent record;
begin
  if tg_op <> 'INSERT' then old_parent := (to_jsonb(old)->>tg_argv[0])::bigint; end if;
  if tg_op <> 'DELETE' then new_parent := (to_jsonb(new)->>tg_argv[0])::bigint; end if;
  for parent in
    select i.id, i.is_locked from garments_erp.item i
    where case tg_argv[0]
      when 'item_part_id' then exists (
        select 1 from garments_erp.item_part p where p.item_id = i.id and p.id in (old_parent, new_parent))
      when 'item_size_list_id' then exists (
        select 1 from garments_erp.item_size_list s where s.item_id = i.id and s.id in (old_parent, new_parent))
      else i.id in (old_parent, new_parent)
    end
    order by i.id for update
  loop
    if parent.is_locked then raise exception 'Verified manufactured item structure is immutable'; end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_finished_item_part before insert or update or delete on garments_erp.item_part
for each row execute function garments_access.guard_finished_item_child('item_id');
create trigger guard_finished_item_size before insert or update or delete on garments_erp.item_size_list
for each row execute function garments_access.guard_finished_item_child('item_id');
create trigger guard_finished_checklist before insert or update or delete on garments_erp.production_checklist
for each row execute function garments_access.guard_finished_item_child('item_id');
create trigger guard_finished_cut_ratio before insert or update or delete on garments_erp.item_cut_ratio
for each row execute function garments_access.guard_finished_item_child('item_size_list_id');
create trigger guard_finished_variant_item before insert or update or delete on garments_erp.variant_item
for each row execute function garments_access.guard_finished_item_child('item_part_id');

create function garments_access.guard_finished_size() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from garments_erp.item_size_list s join garments_erp.item i on i.id = s.item_id
    where s.size_list_id = old.id and i.is_locked
  ) then raise exception 'Shared sizes used by verified manufactured items are immutable'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_finished_size before update or delete on garments_erp.size_list
for each row execute function garments_access.guard_finished_size();

create function garments_access.guard_finished_catalogue() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.verified_by_employee_id is not null then raise exception 'Retire verified configurations instead'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if not old.is_active and new.is_active then raise exception 'Retirement is permanent'; end if;
    if old.verified_by_employee_id is not null then
      if (to_jsonb(new) - array['name', 'is_active', 'updated_at'])
          is distinct from (to_jsonb(old) - array['name', 'is_active', 'updated_at']) then
        raise exception 'Verified commercial configurations are immutable';
      end if;
      return new;
    end if;
  end if;
  if new.verified_by_employee_id is not null then
    if not exists (select 1 from garments_erp.employee e where e.id = new.verified_by_employee_id and e.is_active)
    then raise exception 'Select an active employee'; end if;
    if tg_table_name = 'item_in_store_variation' then
      if not exists (select 1 from garments_erp.sellable_unit u where u.item_in_store_variation_id = new.id)
         or exists (
           select 1 from garments_erp.sellable_unit u where u.item_in_store_variation_id = new.id
           and not exists (select 1 from garments_erp.item_produced p where p.item_id = u.item_id)
         ) then raise exception 'Each component item needs verified finished stock-in'; end if;
      new.verified_at := now();
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_finished_product before insert or update or delete on garments_erp.item_in_store
for each row execute function garments_access.guard_finished_catalogue();
create trigger guard_finished_variation before insert or update or delete on garments_erp.item_in_store_variation
for each row execute function garments_access.guard_finished_catalogue();

create function garments_access.guard_finished_recipe() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_variation bigint;
  new_variation bigint;
  variation record;
begin
  if tg_op <> 'INSERT' then old_variation := old.item_in_store_variation_id; end if;
  if tg_op <> 'DELETE' then new_variation := new.item_in_store_variation_id; end if;
  for variation in
    select v.verified_by_employee_id from garments_erp.item_in_store_variation v
    where v.id in (old_variation, new_variation) order by v.id for update
  loop
    if variation.verified_by_employee_id is not null then raise exception 'Verified packing recipes are immutable'; end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_finished_recipe before insert or update or delete on garments_erp.sellable_unit
for each row execute function garments_access.guard_finished_recipe();

-- Billing has no posting contract yet. Fail closed if billing data appears
-- before the posted-component and posted-return sources are integrated.
create function garments_access.finished_balances(p_item_id bigint)
returns table (item_id bigint, size_id bigint, produced bigint, adjusted bigint, available bigint)
language plpgsql stable set search_path = '' as $$
begin
  if exists (select 1 from garments_erp.billing_item_piece_per_size)
     or exists (select 1 from garments_erp.return_bill_item) then
    raise exception 'Finished stock requires the billing posting integration';
  end if;
  return query
    select s.item_id, s.id, coalesce(p.pieces, 0), coalesce(a.delta, 0),
      coalesce(p.pieces, 0) + coalesce(a.delta, 0)
    from garments_erp.item_size_list s
    left join (
      select pp.item_size_list_id, sum(pp.pieces) as pieces
      from garments_erp.item_produced_pieces pp group by pp.item_size_list_id
    ) p on p.item_size_list_id = s.id
    left join (
      select sa.item_size_list_id, sum(sa.quantity_delta) as delta
      from garments_erp.stock_adjustment sa group by sa.item_size_list_id
    ) a on a.item_size_list_id = s.id
    where p_item_id is null or s.item_id = p_item_id;
end;
$$;

create function garments_access.create_finished_stock(
  p_item_id bigint, p_job_id bigint, p_employee_id bigint, p_pieces jsonb, p_request_id uuid
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  receipt_id bigint;
  prior garments_erp.item_produced%rowtype;
  saved_pieces jsonb;
begin
  if not garments_access.has_screen_permission('finishedProducts', 'create') then
    raise exception 'Finished Products create access required' using errcode = '42501';
  end if;
  if p_request_id is null or jsonb_typeof(p_pieces) is distinct from 'object'
     or p_pieces = '{}'::jsonb then raise exception 'A request ID and size quantities are required'; end if;
  perform 1 from garments_erp.item where id = p_item_id for update;
  if not found then raise exception 'Manufactured item not found'; end if;
  select * into prior from garments_erp.item_produced where request_id = p_request_id;
  if found then
    select jsonb_object_agg(item_size_list_id::text, pieces) into saved_pieces
    from garments_erp.item_produced_pieces where item_produced_id = prior.id;
    if (prior.item_id, prior.completed_job_id, prior.verified_by, saved_pieces)
      is distinct from (p_item_id, p_job_id, p_employee_id, p_pieces) then
      raise exception 'Request ID already used with different stock-in details';
    end if;
    return prior.id::text;
  end if;
  if not exists (select 1 from garments_erp.employee where id = p_employee_id and is_active)
  then raise exception 'Select an active employee'; end if;
  perform p.id from garments_erp.item_part ip join garments_erp.production p on p.item_part_id = ip.id
    where ip.item_id = p_item_id order by p.id for update of p;
  if not exists (
    select 1 from garments_erp.item_part ip join garments_erp.production p on p.item_part_id = ip.id
    join garments_erp.job j on j.production_id = p.id and j.latest
    where ip.item_id = p_item_id and j.id = p_job_id
  ) or exists (
    select 1 from garments_erp.item_part ip
    where ip.item_id = p_item_id and not exists (
      select 1 from garments_erp.production p
      join garments_erp.job j on j.production_id = p.id and j.latest
      join garments_erp.stage s on s.id = j.stage_id
      join garments_erp.stage_type st on st.id = s.stage_type_id
      where p.item_part_id = ip.id and lower(st.name) = 'complete'
    )
  ) then raise exception 'Every item part must have a current completed job'; end if;

  perform z.id from garments_erp.size_list z join garments_erp.item_size_list s on s.size_list_id = z.id
    where s.item_id = p_item_id order by z.id for update of z;
  if exists (
    select 1 from jsonb_each(p_pieces) q
    left join garments_erp.item_size_list s on s.id::text = q.key and s.item_id = p_item_id
    where s.id is null or case when jsonb_typeof(q.value) = 'number' then
      q.value::numeric < 0 or q.value::numeric > 2147483647 or q.value::numeric <> trunc(q.value::numeric)
      else true end
  ) or not exists (select 1 from jsonb_each(p_pieces) q where q.value > '0'::jsonb)
  then raise exception 'Enter valid whole quantities for this item, including at least one positive quantity'; end if;

  insert into garments_erp.item_produced (item_id, completed_job_id, verified_by, request_id)
  values (p_item_id, p_job_id, p_employee_id, p_request_id) returning id into receipt_id;
  insert into garments_erp.item_produced_pieces (item_produced_id, item_size_list_id, pieces)
  select receipt_id, q.key::bigint, q.value::numeric::integer from jsonb_each(p_pieces) q;
  update garments_erp.item set is_locked = true where id = p_item_id and not is_locked;
  return receipt_id::text;
end;
$$;

create function garments_access.adjust_finished_stock(
  p_item_id bigint, p_size_id bigint, p_delta numeric, p_reason text, p_employee_id bigint, p_request_id uuid
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  adjustment_id bigint;
  prior garments_erp.stock_adjustment%rowtype;
  balance bigint;
begin
  if not garments_access.has_screen_permission('finishedProducts', 'create') then
    raise exception 'Finished Products create access required' using errcode = '42501';
  end if;
  if p_request_id is null or p_delta is null or p_delta < -2147483648 or p_delta > 2147483647
     or p_delta <> trunc(p_delta) or nullif(btrim(p_reason), '') is null
  then raise exception 'Provide a signed whole quantity, reason and request ID'; end if;
  perform 1 from garments_erp.item where id = p_item_id and is_locked for update;
  if not found then raise exception 'Verified finished stock-in is required'; end if;
  select * into prior from garments_erp.stock_adjustment where request_id = p_request_id;
  if found then
    if (prior.item_id, prior.item_size_list_id, prior.quantity_delta, prior.reason, prior.verified_by)
      is distinct from (p_item_id, p_size_id, p_delta, btrim(p_reason), p_employee_id) then
      raise exception 'Request ID already used with different adjustment details';
    end if;
    return prior.id::text;
  end if;
  if not exists (select 1 from garments_erp.employee where id = p_employee_id and is_active)
  then raise exception 'Select an active employee'; end if;
  select b.available into balance from garments_access.finished_balances(p_item_id) b where b.size_id = p_size_id;
  if not found then raise exception 'Size does not belong to the manufactured item'; end if;
  if balance + p_delta < 0 then raise exception 'Adjustment would make stock negative'; end if;
  insert into garments_erp.stock_adjustment (item_id, item_size_list_id, quantity_delta, reason, verified_by, request_id)
  values (p_item_id, p_size_id, p_delta::integer, btrim(p_reason), p_employee_id, p_request_id)
  returning id into adjustment_id;
  return adjustment_id::text;
end;
$$;

create function garments_access.finished_stock(
  p_item_id bigint, p_sku text, p_variation_id bigint, p_limit integer, p_offset integer
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not garments_access.has_screen_permission('finishedProducts', 'view') then
    raise exception 'Finished Products view access required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset < 0
  then raise exception 'Invalid pagination'; end if;
  return (
    with balances as materialized (select * from garments_access.finished_balances(null)),
    variations as (
      select v.id, v.name, product.sku,
        min(coalesce(b.available, 0) / u.share_weight) as capacity,
        jsonb_agg(jsonb_build_object('item_id', u.item_id::text, 'size_id', u.item_size_list_id::text,
          'share_weight', u.share_weight, 'available', coalesce(b.available, 0))
          order by u.item_id, u.item_size_list_id) as components
      from garments_erp.item_in_store_variation v
      join garments_erp.item_in_store product on product.id = v.item_in_store_id
      join garments_erp.sellable_unit u on u.item_in_store_variation_id = v.id
      left join balances b on b.size_id = u.item_size_list_id
      where product.is_active and v.is_active and product.verified_by_employee_id is not null
        and v.verified_by_employee_id is not null
        and (p_sku is null or product.sku = p_sku)
        and (p_variation_id is null or v.id = p_variation_id)
        and (p_item_id is null or exists (
          select 1 from garments_erp.sellable_unit c
          where c.item_in_store_variation_id = v.id and c.item_id = p_item_id
        ))
      group by v.id, product.sku
    )
    select jsonb_build_object(
      'sizes', coalesce((
        select jsonb_agg(jsonb_build_object('item_id', b.item_id::text, 'size_id', b.size_id::text,
          'produced', b.produced, 'adjusted', b.adjusted, 'available', b.available)
          order by b.item_id, b.size_id)
        from (
          select * from balances b
          where (p_item_id is null or b.item_id = p_item_id)
            and ((p_sku is null and p_variation_id is null) or exists (
              select 1 from variations v join garments_erp.sellable_unit u on u.item_in_store_variation_id = v.id
              where u.item_size_list_id = b.size_id
            ))
          order by b.item_id, b.size_id limit p_limit offset p_offset
        ) b
      ), '[]'::jsonb),
      'variations', coalesce((
        select jsonb_agg(jsonb_build_object('id', v.id::text, 'name', v.name,
          'sku', v.sku, 'capacity', v.capacity, 'components', v.components) order by v.id)
        from (select * from variations order by id limit p_limit offset p_offset) v
      ), '[]'::jsonb)
    )
  );
end;
$$;

create function public.erp_create_finished_production(
  p_item_id bigint, p_job_id bigint, p_employee_id bigint, p_pieces jsonb, p_request_id uuid
) returns text language sql set search_path = '' as $$
  select garments_access.create_finished_stock(p_item_id, p_job_id, p_employee_id, p_pieces, p_request_id);
$$;
create function public.erp_adjust_finished_stock(
  p_item_id bigint, p_size_id bigint, p_delta numeric, p_reason text, p_employee_id bigint, p_request_id uuid
) returns text language sql set search_path = '' as $$
  select garments_access.adjust_finished_stock(p_item_id, p_size_id, p_delta, p_reason, p_employee_id, p_request_id);
$$;
create function public.erp_warehouse_stock(
  p_item_id bigint default null, p_sku text default null, p_variation_id bigint default null,
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language sql stable set search_path = '' as $$
  select garments_access.finished_stock(p_item_id, p_sku, p_variation_id, p_limit, p_offset);
$$;

revoke all on function
  garments_access.reject_finished_edit(), garments_access.guard_finished_item(),
  garments_access.guard_finished_item_child(), garments_access.guard_finished_size(),
  garments_access.guard_finished_catalogue(), garments_access.guard_finished_recipe(),
  garments_access.finished_balances(bigint)
from public, anon, authenticated;
revoke all on function
  garments_access.create_finished_stock(bigint,bigint,bigint,jsonb,uuid),
  garments_access.adjust_finished_stock(bigint,bigint,numeric,text,bigint,uuid),
  garments_access.finished_stock(bigint,text,bigint,integer,integer),
  public.erp_create_finished_production(bigint,bigint,bigint,jsonb,uuid),
  public.erp_adjust_finished_stock(bigint,bigint,numeric,text,bigint,uuid),
  public.erp_warehouse_stock(bigint,text,bigint,integer,integer)
from public, anon;
grant execute on function
  garments_access.create_finished_stock(bigint,bigint,bigint,jsonb,uuid),
  garments_access.adjust_finished_stock(bigint,bigint,numeric,text,bigint,uuid),
  garments_access.finished_stock(bigint,text,bigint,integer,integer),
  public.erp_create_finished_production(bigint,bigint,bigint,jsonb,uuid),
  public.erp_adjust_finished_stock(bigint,bigint,numeric,text,bigint,uuid),
  public.erp_warehouse_stock(bigint,text,bigint,integer,integer)
to authenticated;

commit;
