# Production hub and ER alignment — prepared migration

Status: prepared locally; **not applied to production**. The existing frontend has not been changed. This document records the business rules agreed in the ER review, rather than the older Production preview contract.

Migration: [`20261105135706_production_hub_and_review_ownership.sql`](../../supabase/migrations/20261105135706_production_hub_and_review_ownership.sql). Requires the two November 4 migrations already recorded in production.

## Database ownership and movement

- `production.item_part_id` is unique. An item part is produced once. Production has exactly one board, and jobs and multiple assignees link to production.
- Every production has exactly one `job.latest=true`, including its final completed job. A unique partial index prevents two current jobs; deferred constraints prevent a production with no current job or board from committing.
- Every job has exactly one editable `job_item_status_list` row. This is current operational status, not an event ledger. `job_status_history` and its recorder are removed.
- Starting production creates its first job and board atomically. An advance creates a new job at the next stage. Every move checks the expected source job under the production lock.
- Rectification selects an earlier job on the current route. It creates no job, makes that earlier job current and clears only its completion date. Earlier dates, worker, quantities and challans remain attached to their original jobs.
- Example: C1 → S1 → rectify C1 → new S2 → P1. The current route is C1 → S2 → P1; S1 remains historical. Rectifying P1 directly to C1 is allowed; returning to abandoned S1 is not.
- `job_transition_log` preserves every advance/rectify event, operator, selected verifier, reason and timestamp. Its rows cannot be updated or deleted. `production_path()` replays those events to distinguish the active route from abandoned attempts. New jobs receive output from the most recent tracked job on this route, carrying it across untracked stages. The first tracked stage uses planned cut ratios and the existing equal-share/largest-remainder allocation.
- Stage moves require a short-lived, single-use proof bound to the operator, selected verifier, live password session and exact command. The selected employee can be the operator. Both require an active linked account/employee and the relevant Production permission. The operator's existing MFA gate remains in force; the selected verifier confirms their password separately.

## Lab Dip, Employee, Fabric and Inventory

- Physical `lab_dip_version` no longer has `date`, `comments` or `lab_dip_status_id`. They exist only in `lab_dip_version_item`. Reviews append a new row and demote the prior `latest` row under the edition lock. Submitted review content cannot be overwritten. Retry-after-Failed and approved-edition locking remain enforced.
- The existing Fabric RPC temporarily accepts its existing review payload and translates it into child writes. Its JSON snapshot derives the old flattened review fields from the current child row. This is API compatibility, not duplicate physical storage. The new review API writes the child owner directly. The existing Fabric audit and source-type validation are retained.
- Employee creates/edits automatically record the logged-in operator as verifier; caller-supplied verifier fields are rejected. No separate Employee password proof is required. New portal-created employees are active and verified. Ordinary edits preserve active/inactive state. Explicit activation/deactivation records the operator, and deactivation revokes existing sessions. HR activation never overrides an administrator-disabled account. Existing Employee proof endpoints remain legacy interfaces; the new save path does not use their proofs.
- Receipt fields become `inward_date`, `billed_quantity`, `billed_price`. Receipts select the exact PO line; a composite FK enforces that the line and material match. Redundant receipt PO-header/supplier fields are removed; these are obtained through the line/header relationship.
- `dyeing_program_item.batch_no` becomes a bigint FK to the batch-mapping **ID**. Existing text batch references are translated through the old unique batch number. Exact Lab Dip consistency and rejection of a program referencing its own output remain enforced.
- Adds dyed-fabric bill verifier, employment-type description and the TNA checklist status. Existing checklist fields are preserved. Derived `fabric_name` already exists in `view_knitted_fabric_name` and is reused instead of introducing a stored copy. The existing Employee photo representation is outside this change; the diagram contains duplicate photo entries with conflicting representations.
- New tables use RLS with direct browser privileges revoked. Public RPCs retain permission checks, revision/conflict checks and safe bigint serialization. No UI code, schema capture of the still-live database, or unrelated contact ownership has changed.

## Existing data and rollout

Existing jobs are grouped by item part, assignees are deduplicated into production membership, and one board/status row is backfilled. The current legacy job is selected deterministically: incomplete jobs first, then latest start/creation date and ID. This is an initial candidate, not reconstructed movement history; the migration does not invent historical transitions. Existing review and receipt values are retained where usable. Dropped job status history, redundant columns and ambiguous old header-only receipt links are not archived, as authorized.

The receipt field names, batch FK meaning and new Production/Employee workflow are changes the subsequent UI work must adopt. Passing the static coherence checker against its older schema baseline does not mean that the old UI already implements this new contract. Do not describe the whole ERP as UI-aligned after a database-only release.

The migration is transactional and is listed in `scripts/ci/database-release.mjs`; post-release checks verify the new schema/security invariants before commit. Deployment remains a reviewed `dev` → `main` release through `.github/workflows/database-release.yml`, with its existing checks and environment protections. Preparing this migration has not dispatched that workflow.

## Validation

- Full baseline/prior-migration replay plus this migration in a separate disposable local database.
- Populated replay: `bash scripts/ci/test-production-migration.sh`, including duplicate job assignees, job status, current-job selection, Lab Dip review preservation, receipt values and batch-ID conversion. Fixtures are synthetic.
- Rollback-only workflow assertions: `database/tests/production-hub-and-review-ownership.sql` and `database/tests/lab-dip-status-items.sql`.
- Existing Fabric/database, account-security, Employee and Contacts integration assertions against the migrated disposable database.
- Two-session production concurrency test in `fabric-poc/integration/production-security.mjs`; the second advance must wait and then reject its stale source, leaving one new job and one transition.
- SQL function/trigger dependency lint, release postcondition query, release/CI unit tests, coherence, formatting and diff checks.

The main isolated database runner includes the new workflow, concurrency and populated migration checks. These checks do not perform production writes.
