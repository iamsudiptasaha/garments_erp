-- Review before production: a stale AAL2 token must not survive removal of its last authenticator.
begin;
create or replace function garments_access.session_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'aal'='aal2',false)
 and exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()))
 and exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.factor_type='totp' and f.status='verified')
 and exists(select 1 from garments_access.app_user u where u.user_id=auth.uid() and u.is_active and not u.must_change_password);
$$;
revoke all on function garments_access.session_ready() from public,anon;
commit;
