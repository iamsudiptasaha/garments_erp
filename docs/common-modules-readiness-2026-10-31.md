# Files and Administration production verification

Date: 31 October 2026. Branch: dev. **Verdict: not approved for production.** No production records, permissions, configuration, buckets or deployed functions were changed during this audit.

## Subsequent implementation

The account lifecycle has since been implemented locally and Docker launch was resolved with the required sandbox permission. Fresh database and actual local Auth/TOTP/Storage tests now pass. See [account rollout](account-lifecycle-rollout.md) for the current implementation and remaining SMTP/production approval items. The observations below describe the production state inspected before these unapplied changes.

## Verified

- Full local quality command passed: coherence checks, strict TypeScript boundary, lint, formatting, unused/duplicate checks, 111 application tests and build. Focused Files/access/membership selection passed 23 tests (a subset of the 111, not additional coverage). Four security guard tests and frontend bundle guard passed.
- Signed-in local `/files.html` and `/files-admin.html` loaded using the existing session. Bucket registry and nine route definitions rendered from live Supabase. No mutations were submitted.
- Read-only live catalogue checks found five registered buckets, all private, each capped at 10 MiB with PDF/JPEG/PNG/WebP bucket types. Item-image and lab-dip route policies restrict their slots to images. All nine route keys match frontend integrations and actual attachment FK columns.
- `bucket_group`, `attachments`, employee and all ten access-schema tables inspected have RLS enabled and no direct anonymous SELECT or authenticated write privileges. Public `erp_*` wrappers are not SECURITY DEFINER. Private guarded operations perform current actor checks.
- Live `save_account_access` source serializes changes, requires an administrator, checks stale revisions, rejects inactive roles and prevents removal of the last enabled administrator. Live upload finalisation locks the target record, checks previous attachment identity, validates object size/MIME and writes the attachment link plus audit in one transaction.
- Deployed `erp-files` v2 source matches the local source inspected. It validates the Auth user, authorizes operations through guarded user RPCs, uses server-only storage credentials, checks PDF/image signatures, uses non-overwriting uploads and generates 60-second read URLs. Signature checks are not malware scanning.

## Release blockers

1. **Confirmed database authorization bypass outside the guarded boundary.** Live `garments_erp.item`, `raw_material_check_in` and `job_worker_bill` lack RLS, permit anonymous SELECT and authenticated writes. These tables contain supported attachment fields. Direct writes can bypass the portal's business permissions and attachment-link workflow even though attachment metadata itself is protected. The advisor reports broader exposed tables, including a separate `erp_sandbox` schema. The previously proposed hardening migration has not been applied. Review integration compatibility before any permission changes; do not silently break other applications.
2. **Account lifecycle is incomplete.** The panel links existing Auth identities; it does not create ordinary employee login accounts, provide a password-change flow or implement the requested recovery process. Recovery is correctly labelled unavailable. Existing-account role management alone is a narrower usable scope, not a completed user-management module.
3. **Deployed account helper audit is incomplete.** Seven legacy `admin-*` functions are listed ACTIVE. Retrieval attempts for create/update/delete/get returned UNAVAILABLE. JWT verification only proves authentication, not administrator authorization. Their internal authorization cannot be certified from the available evidence. Obtain/deploy reviewed source or explicitly retire unused endpoints through an approved change; do not presume they are vulnerable or safe.
4. **Fresh isolated database/storage integration verification could not run.** Docker daemon is unavailable and `/Applications/Docker.app` cannot launch because its executable is missing. Prior isolated test evidence is historical, not a fresh run of this audit. Do not run fixture mutations against production as a substitute. Rerun authorization, stale/concurrent updates, last-admin protection, upload finalisation/cleanup and bucket-removal tests in a functioning isolated environment, followed by synthetic authenticated Storage/HTTP tests.

## Additional scope and follow-up

- Five attachment FKs are not routed: buyer PO, transport bill, transport docket, return bill and bank supporting documents. They belong to later modules and must remain unsupported rather than silently mapped to a bucket. Nine current integrations are consistent.
- Supabase advisors also report mutable search paths on three functions, an anonymously executable public SECURITY DEFINER event-trigger function, and leaked-password protection disabled. Review impact and configuration before production sign-off. RLS-without-policy notices on the private guarded tables are expected default-deny behaviour, not a reason to add broad policies.
- No actual upload/download/cleanup/removal or role/account mutation was executed against production. Read-only browser checks do not establish those end-to-end guarantees.
- Test logs with error-severity filters returned no matching rows, which is not proof that all services are healthy or that all error formats were covered.

Advisor references: [exposed tables without RLS](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public), [function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [anonymous SECURITY DEFINER execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Exit criteria

Review and approve the permission-boundary changes; complete or explicitly limit the account lifecycle release scope; verify legacy admin endpoints; pass fresh isolated database and authenticated staging Storage tests. Then repeat the read-only deployed checks and obtain explicit release approval. Do not deploy on the strength of local unit tests alone.
