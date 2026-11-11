-- Personal presentation settings, independent of ERP record permissions.
begin;

create table public.erp_user_grid_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  grid_key text not null check (grid_key ~ '^[a-zA-Z][a-zA-Z0-9-]{0,79}$'),
  preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 1048576),
  primary key (user_id, grid_key)
);

alter table public.erp_user_grid_preferences enable row level security;
revoke all on public.erp_user_grid_preferences from public, anon, authenticated;
grant select, insert, update on public.erp_user_grid_preferences to authenticated;

create policy own_grid_preferences on public.erp_user_grid_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create function public.erp_grid_preferences(p_grid text, p_owner uuid, p_patch jsonb)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  result jsonb;
begin
  if owner_id is null or owner_id is distinct from p_owner then
    raise exception 'Grid preferences require the current account' using errcode = '42501';
  end if;

  if p_patch is null then
    select preferences into result from public.erp_user_grid_preferences
    where user_id = owner_id and grid_key = p_grid;
  else
    insert into public.erp_user_grid_preferences as saved (user_id, grid_key, preferences)
      values (owner_id, p_grid, p_patch)
    on conflict (user_id, grid_key) do update
      set preferences = saved.preferences || excluded.preferences
    returning preferences into result;
  end if;
  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.erp_grid_preferences(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.erp_grid_preferences(text, uuid, jsonb) to authenticated;

commit;
