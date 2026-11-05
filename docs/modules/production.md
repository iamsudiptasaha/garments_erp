# Production

**Portal preview workflows with historical database changes.** Item and job/task views use browser-local data. Items combine size quantities, variants, parts, optional brand-scoped lab-dip edition and checklist statuses. The stage board shows sent and final counts. Manual and keyboard-wedge style search exist.

An item owns item parts and item-size rows. `variant_item` connects a variant to an item part and optional lab-dip edition. The live schema gives each item part a permanent Production record. Jobs belong to that Production record and a stage; assignees belong to Production, status to one job status row, and verifier attribution to movement history. The frozen legacy preview adapter retains its older local record shape. `variant_item_per_job` and item size identify stage-piece rows. Challan piece rows reference variant items. Checklist statuses use `item_status_list`, including Disputed. Keep the schema spelling `techpack_aqcuired_status_id` and `ordersheet_acquired_status_id`.

Advancing creates a new stage job. Rectify reopens an earlier job on the actual path; existing job stage identity cannot change. Pre-production excludes piece tracking. Tracked production starts from planned sizes and the intended handoff carries prior checkout forward. Counts are whole and non-negative, and zero differs from blank. Equal variant shares are enforced for the pilot with `share_weight = 1`. Largest-remainder allocation preserves totals and breaks ties by variant ID in the live command.

Pending: review ownership and live transactions before changing frozen source. A guarded next-stage handoff, live verifier identity, floor links, challan creation/printing, camera scanning, parallel dependencies and TNA are outside current scope. Preview quantities from earlier stages are references rather than live stock transactions.

Sources: [Production source](../../fabric-poc/src/production), [job and checklist SQL](../../database/applied/20261029154453_correct_checklist_and_production_variant_relationships.sql), [equal-share and checklist SQL](../../database/applied/20261029155621_equal_variant_shares_and_checklist_document_statuses.sql), [ownership contract](../../database/contracts/ownership.json).

## Task Board and operator handover

The actual portal now has **Production → Task Board** at `/fabric.html#productionTaskBoard` and **Update Tasks** at `/fabric.html#productionUpdateTaskStatus`. These reuse the finalized React/TypeScript List, Table, Kanban, task modal and searchable handover form from `fabric-poc/src/production-task-board`. Styles are isolated from the portal shell. The older Jobs screen is retained as **Job history**, with read-only attempts and quantity details.

This is the portal’s browser-local Production workspace, not a live Supabase adapter. Data comes from the portal’s items, linked variants, sizes, ordered stages, existing job history and employee choices; no 50-task mock fixture is inserted into the portal. Local handovers update original job/variant/size records and preserve original IDs and challan links. The board aggregate persists alongside the existing preview data; named saved views are removed from the portal MVP; layout controls remain local. Planned pieces is a read-only sum of the item’s size allocations. Existing `productionJobs` view/edit permissions govern both new pages.

The local floor route `/fabric.html?floor=1&task=production-prod-ip-1#productionUpdateTaskStatus` reuses the same form without portal navigation. This is a local validation route, not deployed unauthenticated QR access. The signed-in live workspace still blocks Production business writes: pending migration `20261105173810_production_atomic_employee_handover.sql` implements stage skipping, all-variant atomic quantity handover and employee-selection-only attribution. It is not applied to production. Portal session/role checks stay intact; this does not expose anonymous QR writes. No live login or security gate was removed.

Checks cover portal navigation, real preview dimensions, incomplete quantity blocking, original job/piece linkage, reload persistence, carry-forward, standalone mobile rendering and role restrictions. Frozen legacy Production sources remain unchanged; the new boundary is documented under `localWorkspaces.productionTaskBoard` in the ownership contract.

## Approved MVP navigation and pending command

Task Board and Update Tasks lead the Production menu. Item parts and Item sizes are hidden from primary navigation, retaining their routes and records; Items remains their owning setup flow. Variants, Job workers, Stages and the other reference editors are unchanged. Flags and Gender have separately permissioned local reference editors. Flag choices on tasks use the configured Flags library. Job history cannot independently create or save a job; handovers use the shared operator form.

The pending command accepts an active selected employee without an extra employee password challenge. The authenticated portal actor and existing Production permissions remain authoritative. Each tracked-stage movement submits exactly one whole non-negative output per linked variant/size; zero and unequal totals are valid. Outputs, destination job/current switch, carry-forward and immutable movement output snapshot commit together. Expected latest transition ID plus source job identify the current visit and reject duplicate/stale handovers, including after rectification reopens the same original job. Pre-production/untracked stages submit no quantities. Earlier actual-path destinations still require a reason.

The local portal stays behind the existing live-write gate until a reviewed live adapter and release. Migration validation runs only against disposable local databases; release remains GitHub Actions through reviewed Git.

Task Board preserves first-job creation through Start production: select a prepared existing item part and active employee; create one task at the first configured stage. Existing create permission is separate from handover/edit permission. Initial tracked quantities use item size allocations and equal variant shares. Local-only job codes are labelled LOCAL; live codes remain generated by the database.

## Task Board presentation update

Portal Task Board and Update Tasks use the portal blue palette. Kanban lanes stack header, cards and totals vertically and expand to fill the workspace. Stage type is derived from the current stage FK and is read-only; it can be shown, grouped, filtered and sorted across views. Dragging between stage-type lanes cannot edit the reference definition or bypass stage handover.

Item image visibility is available as an optional List/Table column and Kanban card field, and in task details. The local preview displays attachment presence or missing-image placeholders; it does not resolve private Storage attachments to public URLs. Actual image rendering needs the authorised Files read path when a live Production adapter is reviewed.

Tracked stages still require all variant/size outputs. Untracked stages show a simplified no-quantity handover, preserve size dimensions and restore required entry at the next tracked stage. Job History is unchanged by this presentation update.

For the dated live-schema audit, pending migration and commit/release boundaries, see [Production MVP review](../runbooks/production-mvp-review.md).

Items includes an optional editable Batch number and list column, owned by `item.batch_number` (nullable text). Pending migration `20261105192048_add_item_batch_number.sql` adds it without backfill, generation or uniqueness. It is unrelated to Fabric dyeing batch references.
