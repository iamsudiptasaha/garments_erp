-- Run without a JWT. This verifies denial, not simulated account access.
do $$
begin
 if auth.uid() is not null then raise exception 'Run this test without an Auth identity';end if;
 begin
  perform public.erp_fabric_snapshot();
  raise exception 'Unauthenticated Fabric read unexpectedly succeeded';
 exception when insufficient_privilege then null;end;
 begin
  perform public.erp_save_fabric_document('colours','{"table":"color_map","id":"00000000-0000-4000-8000-000000000001"}'::jsonb,'create','[{"table":"color_map","id":"00000000-0000-4000-8000-000000000001","before":null,"values":{"name":"must-never-insert"}}]'::jsonb);
  raise exception 'Unauthenticated Fabric write unexpectedly succeeded';
 exception when insufficient_privilege then null;end;
 if has_function_privilege('anon','public.erp_fabric_snapshot()','execute') or has_function_privilege('anon','public.erp_save_fabric_document(text,jsonb,text,jsonb)','execute') then raise exception 'Anonymous RPC execution is exposed';end if;
end $$;
