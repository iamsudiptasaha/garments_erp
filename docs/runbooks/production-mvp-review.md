# Production MVP commit and release review

Verified 6 November 2026 against Supabase project `kidvckaicclqvtlddeyz` using read-only metadata queries.

## Live baseline and pending change

Latest live migration: `20261105161411`. Production, Job and Stage each contain zero records. No stage seed was inferred from the diagram or inserted live.

Live ownership is Production → item part; Job → Production and stage; status → job status row; assignees → Production; checklist → item; quantity → job variant and item size; verifier → immutable transition history. The legacy browser-preview record shape is intentionally isolated behind the live-page gate and must not be submitted as live SQL records.

Pending migration: `supabase/migrations/20261105173810_production_atomic_employee_handover.sql`.

- Allows any later stage without fabricating skipped jobs.
- Replaces the extra verifier-password endpoint with selection of an active employee; retains authenticated portal session, MFA and Production create/edit authorization.
- Locks Production and checks source job plus expected latest transition ID to prevent duplicate/stale handovers, including reopened jobs.
- Validates every linked variant/size once; whole non-negative counts, explicit zero and unequal totals are valid.
- Commits outputs, destination/current-job switch, carry-forward and immutable quantity snapshot atomically.
- Untracked/pre-production stages submit no quantities; the next tracked stage uses the last tracked output or initial size allocation.
- Rectification reopens the original job on the actual path and preserves its incoming quantities.
- Adds no anonymous or direct-table business-write grants.

The migration is already included in the reviewed database release script and isolated test runner. It has not been applied live.

## Commit scope

Include the Production Task Board/shared operator UI and tests, portal navigation/catalogue integration, dependencies and build configuration, reviewed ownership/catalogue changes, pending migration and SQL/integration/release tests. Preserve separately authored documentation reorganization and unrelated working-tree changes; do not indiscriminately stage the entire repository. Job History redesign remains deferred.

Final fixes include active employee choices, Asia/Kolkata movement/overdue dates, per-job input preservation on rectification and portal font-colour assertions.

## Validation

- Full frontend quality suite: coherence, types, lint, formatting, unused/duplicate checks, 144 unit tests and build.
- 27 Production browser tests, covering all views, portal colours, role restrictions, quantities, stage skips, rectification, untracked carry-forward and persistence.
- Full isolated database replay/security/atomicity/concurrency/backfill/restore suite, including tracked → untracked → tracked quantities.
- Local database function lint exits successfully with no Production findings; existing warnings remain in other modules.
- Catalogue and release/configuration-policy tests; diff whitespace check.

## Remaining go-live work

This is commit-ready preview code and a tested pending migration, not a live Production rollout. A reviewed live adapter is still required for reads, document saves and the movement RPC; employee names must resolve to employee IDs. Private item-image rendering needs the authorised Files read path; preview controls currently show placeholders. Configure stage/reference records before starting live Production. Hosted anonymous QR access remains out of scope.

Release only through reviewed GitHub Actions after merge to main and the configured backup/environment gates. Never run production SQL locally. Existing unrelated Supabase advisories (sandbox RLS and legacy helper permissions) were observed and are not repaired by this Production migration; see the [Supabase security advisory guide](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public).
