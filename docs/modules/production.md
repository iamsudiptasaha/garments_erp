# Production

Production's live portal connection is implemented in `fabric-poc/src/production-task-board`. It requires migration `20261106054224_connect_production_workspace.sql`, which is prepared for review and has not been released by this change. Job History is explicitly excluded and unchanged.

## Portal and ownership

Task Board (`/fabric.html#productionTaskBoard`) and Update Tasks (`/fabric.html#productionUpdateTaskStatus`) use the authenticated database snapshot and guarded commands. No mock tasks or browser-local business data are used in live mode. List, Table and Kanban share canonical server responses. Failed saves show the server error; handover success appears only after the command succeeds. Production service errors do not block Fabric pages.

A Production belongs permanently to an item part. Jobs belong to Production and a stage, with exactly one current job. Assignees and flags belong to Production; due date belongs to the current job, and job status to `job_item_status_list`. Stage type is derived from the stage FK and remains available for display, grouping, filtering and sorting. Planned pieces is the read-only sum of the item's size allocations. Progress describes position in the configured stage sequence, not accepted piece completion. Priority has no database field and is unavailable for live edits. Named saved views remain removed; layout preferences are browser-local.

Items owns parts, size allocations, variant links and the five item-wide checklist statuses. Shared variants are selected in Items and edited in Variants. Items cannot rename shared variant records. Item images use the existing private Files service, with expiring URLs refreshed while displayed. Production-only viewers can read images of items linked to Production; this does not grant image upload or item-edit permission. Optional `item.batch_number` is manually entered nullable text with no generation or uniqueness rule.

The live reference editors cover Job workers, Variants, Stages, Stage types, Part names, Sizes, Product types, Job statuses, Flags and Gender. Brands retains its existing Fabric command. Item parts and Item sizes stay out of primary navigation; Items is their owning setup flow. No reference stages or mock business records are silently seeded. Job counts follow `job.production_id → production.item_part_id`, rather than the retired job-to-part relationship.

## Start and handover

Start production selects an existing item part and active employee, then calls the database command to create the Production and its first job. Create and edit permissions remain separate under `productionJobs`. Job codes and identifiers are assigned by the database; bigint IDs stay strings in transport.

The existing atomic handover migration `20261105173810_production_atomic_employee_handover.sql` supports any later stage and rectification to an earlier job on the actual path. Rectification requires a reason. Every variant/size output must be explicit for a tracked stage: whole non-negative numbers, including zero; unequal totals are accepted. Untracked/pre-production stages submit no quantities. Outputs, destination/current switch, carry-forward and immutable movement snapshot commit together. Source job and expected transition ID reject stale or duplicate handovers, including reopened visits.

The selected active employee provides MVP attribution; the authenticated session supplies the actor and enforces role/MFA authorization. No additional employee password is requested. The same prefilled operator form serves Update Tasks, task-modal movement and the signed-in floor URL (`/fabric.html?floor=1&task=<production-id>#productionUpdateTaskStatus`). Anonymous QR access remains a separate security decision.

## Verification and release

Reviewed setup fields are mirrored in the SQL and frontend contracts and checked for parity by coherence. Setup saves validate root/child ownership and expected row snapshots. Task edits validate the Production revision and item checklist snapshot. No direct table grants are added. The frozen legacy preview sources remain unchanged; their local adapter is separate from the live commands.

SQL tests cover temporary-ID mapping, checklist persistence, stale saves, permission denial, rollback and restricted image access. Unit/browser checks cover projection, exact quantity IDs, stage skipping, duplicate employee names, reload persistence, all three views, and server-error handling. Browser transport fixtures never use a real account or production writes; isolated SQL/security/concurrency tests validate the actual functions.

Merging a reviewed PR into `main` runs the [production workflow](../secure-ci-setup.md), which applies pending migrations before deploying and verifying the portal.
