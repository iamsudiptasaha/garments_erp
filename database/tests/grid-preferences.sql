begin;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

do $test$
declare
  owner_id constant uuid := '00000000-0000-4000-8000-000000000001';
  other_id constant uuid := '00000000-0000-4000-8000-000000000002';
begin
  perform public.erp_grid_preferences('finished-goods-sizes', owner_id, '{"sort":{"key":"size","direction":"desc"}}');
  perform public.erp_grid_preferences('finished-goods-sizes', owner_id, '{"layout":{"zoomRatio":1.25}}');
  if public.erp_grid_preferences('finished-goods-sizes', owner_id, null)
    <> '{"sort":{"key":"size","direction":"desc"},"layout":{"zoomRatio":1.25}}' then
    raise exception 'Independent preference updates must merge';
  end if;
  perform set_config('request.jwt.claim.sub', other_id::text, true);
  if public.erp_grid_preferences('finished-goods-sizes', other_id, null) <> '{}' then
    raise exception 'Another account inherited grid preferences';
  end if;
  if exists (select from public.erp_user_grid_preferences where user_id = owner_id) then
    raise exception 'RLS exposed another account’s grid preferences';
  end if;
  begin
    perform public.erp_grid_preferences('finished-goods-sizes', owner_id, '{"hidden":["size"]}');
    raise exception 'RPC accepted another account';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.erp_user_grid_preferences (user_id, grid_key) values (owner_id, 'other-grid');
    raise exception 'RLS allowed a write for another account';
  exception when insufficient_privilege then
    null;
  end;
end
$test$;

reset role;
set local role anon;
do $test$
begin
  if has_function_privilege(current_user, 'public.erp_grid_preferences(text,uuid,jsonb)', 'execute')
    or has_table_privilege(current_user, 'public.erp_user_grid_preferences', 'select,insert,update') then
    raise exception 'Anonymous access to grid preferences';
  end if;
end
$test$;

rollback;
