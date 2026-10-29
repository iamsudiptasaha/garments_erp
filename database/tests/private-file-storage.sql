-- Rollback-only verification: no business documents or files are retained.
begin;
select set_config('request.jwt.claim.sub',(select u.user_id::text from garments_access.app_user u join garments_access.app_user_role ur on ur.user_id=u.user_id join garments_access.app_role r on r.id=ur.role_id where u.is_active and r.is_system_admin limit 1),true);
set local role authenticated;
do $$
declare groups jsonb;ticket jsonb;bid text;ver bigint;
begin
 groups:=public.erp_file_registry();
 if jsonb_array_length(groups)<>5 or exists(select 1 from jsonb_array_elements(groups) g where not (g->>'private')::boolean) then raise exception 'Invalid private registry';end if;
 -- Known saved test fixture is created below using an owner transaction before this block in dedicated tests.
 begin perform public.erp_begin_file_upload('yarnBill',9223372036854775807,'test.pdf','application/pdf',9);raise exception 'Missing parent accepted';exception when raise_exception then if sqlerrm not like 'Save the record%' then raise;end if;end;
 begin perform public.erp_file_records('not-allowed','');raise exception 'Unknown target accepted';exception when raise_exception then if sqlerrm<>'Attachment field is not configured' then raise;end if;end;
 select g->>'id',(g->>'version')::bigint into bid,ver from jsonb_array_elements(groups) g where g->>'group'='fabric_bills';
 perform public.erp_save_bucket_group(bid::bigint,ver,'Yarn, knitting and dyeing bills',10485760);
 begin perform public.erp_save_bucket_group(bid::bigint,ver,'stale',10485760);raise exception 'Stale settings accepted';exception when serialization_failure then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
set local role authenticated;
do $$ begin
 begin perform public.erp_file_registry();raise exception 'Unlinked user accepted';exception when insufficient_privilege then null;end;
 begin perform public.erp_save_bucket_group(1,1,'forbidden',10485760);raise exception 'Non-admin settings accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.erp_file_registry()','execute') then raise exception 'Anonymous registry exposed';end if;
 if has_table_privilege('authenticated','garments_access.app_file_upload','insert') then raise exception 'Direct ledger insert exposed';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'erp_%file%' and p.prosecdef) then raise exception 'Public definer exposed';end if;
end $$;
rollback;
