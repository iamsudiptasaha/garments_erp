-- Database-level integration tests, all changes rolled back.
begin;
select set_config('request.jwt.claim.sub',(select u.user_id::text from garments_access.app_user u join garments_access.app_user_role ur on ur.user_id=u.user_id join garments_access.app_role r on r.id=ur.role_id where u.is_active and r.is_system_admin limit 1),true);
do $$
declare r jsonb;ticket jsonb;gid bigint;rid bigint;
begin
 select min(id) into rid from garments_erp.knitting_bill;
 if rid is null then raise exception 'Test requires a saved knitting bill';end if;
 r:=garments_access.file_target('knittingBill');
 select id into gid from garments_erp.bucket_group where "group"='items';
 perform public.erp_save_file_route('knittingBill',gid,array['image/png'],1048576,true,(r->>'version')::bigint);
 r:=garments_access.file_target('knittingBill');
 if r->>'group'<>'items' or r->>'max_bytes'<>'1048576' then raise exception 'Destination/limit did not persist';end if;
 begin perform public.erp_begin_file_upload('knittingBill',rid,'probe.pdf','application/pdf',12);raise exception 'Disallowed PDF accepted';exception when raise_exception then if sqlerrm<>'Unsupported file type' then raise;end if;end;
 begin perform public.erp_begin_file_upload('knittingBill',rid,'probe.png','image/png',1048577);raise exception 'Oversize accepted';exception when raise_exception then if sqlerrm<>'File exceeds upload limit' then raise;end if;end;
 ticket:=public.erp_begin_file_upload('knittingBill',rid,'probe.png','image/png',12);
 if ticket->>'bucket_id'<>'garments-items' then raise exception 'Server ignored destination route';end if;
 begin perform public.erp_save_file_route('knittingBill',gid,array['image/png'],1048576,false,(r->>'version')::bigint);raise exception 'Active upload route edited';exception when raise_exception then if sqlerrm not like 'An upload is in progress%' then raise;end if;end;
 perform public.erp_cancel_file_upload((ticket->>'id')::uuid);
 perform public.erp_file_cleanup_done((ticket->>'id')::uuid);
 perform public.erp_save_file_route('knittingBill',gid,array['image/png'],1048576,false,(r->>'version')::bigint);
 begin perform public.erp_begin_file_upload('knittingBill',rid,'probe.png','image/png',12);raise exception 'Paused upload accepted';exception when raise_exception then if sqlerrm<>'Uploads are disabled for this field' then raise;end if;end;
 perform public.erp_file_list('knittingBill',rid); -- pausing uploads must preserve reads
 begin perform public.erp_save_file_route('knittingBill',gid,array['image/png'],1048576,true,(r->>'version')::bigint);raise exception 'Stale version accepted';exception when serialization_failure then null;end;
 begin perform public.erp_save_file_route('labDipShade',gid,array['application/pdf'],1048576,true,1);raise exception 'PDF image accepted';exception when raise_exception then if sqlerrm<>'This image attachment requires image types' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
set local role authenticated;
do $$ begin
 begin perform public.erp_save_file_route('knittingBill',1,array['image/png'],1048576,true,1);raise exception 'Unlinked user edited route';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.erp_file_routes()','execute') or has_table_privilege('authenticated','garments_access.app_file_route','update') then raise exception 'Route settings exposed';end if;
end $$;
rollback;
