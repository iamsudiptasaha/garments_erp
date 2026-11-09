-- Rollback-only tests. No real buckets are retained or Storage files deleted.
begin;
select set_config('request.jwt.claim.sub',(select u.user_id::text from garments_access.app_user u join garments_access.app_user_role ur on ur.user_id=u.user_id join garments_access.app_role r on r.id=ur.role_id where u.is_active and r.is_system_admin limit 1),true);
do $$
declare created jsonb;group_id bigint;reservation jsonb;r jsonb;
begin
 created:=public.erp_create_bucket_group('rollback_bucket_probe','Temporary rollback fixture',array['image/png'],1048576);group_id:=(created->>'id')::bigint;
 if not exists(select 1 from garments_erp.bucket_group g join storage.buckets b on b.id=g.bucket_id where g.id=group_id and not b.public and b.file_size_limit=1048576 and b.allowed_mime_types=array['image/png']) then raise exception 'Private bucket setup failed';end if;
 begin perform public.erp_create_bucket_group('rollback_bucket_probe','Duplicate',array['image/png'],1048576);raise exception 'Duplicate accepted';exception when raise_exception then if sqlerrm<>'That group key already exists' then raise;end if;end;
 begin perform public.erp_create_bucket_group('bad/../key','Invalid',array['image/png'],1048576);raise exception 'Invalid key accepted';exception when raise_exception then if sqlerrm not like 'Use 2–48%' then raise;end if;end;
 begin perform public.erp_prepare_bucket_removal(group_id,1,'wrong');raise exception 'Missing confirmation accepted';exception when raise_exception then if sqlerrm<>'Type the exact group key to confirm removal' then raise;end if;end;
 reservation:=public.erp_prepare_bucket_removal(group_id,1,'rollback_bucket_probe');
 r:=garments_erp.file_target('knittingBill');
 begin perform public.erp_save_file_route('knittingBill',group_id,array['image/png'],1048576,true,(r->>'version')::bigint);raise exception 'Route assigned during removal';exception when raise_exception then if sqlerrm<>'Bucket removal is in progress' then raise;end if;end;
 begin perform public.erp_finish_bucket_removal(group_id,(reservation->>'token')::uuid);raise exception 'Registry removed before Storage';exception when raise_exception then if sqlerrm<>'Storage bucket has not been removed' then raise;end if;end;
 perform public.erp_cancel_bucket_removal(group_id,(reservation->>'token')::uuid);
 if exists(select 1 from garments_erp.bucket_group where id=group_id and removal_token is not null) then raise exception 'Cancellation failed';end if;
 perform public.erp_save_file_route('knittingBill',group_id,array['image/png'],1048576,true,(r->>'version')::bigint);
 begin perform public.erp_prepare_bucket_removal(group_id,1,'rollback_bucket_probe');raise exception 'Assigned bucket removed';exception when raise_exception then if sqlerrm<>'Reassign every upload route before removing this bucket' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
set local role authenticated;
do $$ begin
 begin perform public.erp_create_bucket_group('forbidden_bucket','Denied',array['image/png'],1048576);raise exception 'Non-admin created bucket';exception when insufficient_privilege then null;end;
 begin perform public.erp_prepare_bucket_removal(1,1,'job_worker_bills');raise exception 'Non-admin prepared removal';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.erp_create_bucket_group(text,text,text[],bigint)','execute') then raise exception 'Anonymous creation exposed';end if;
end $$;
rollback;
