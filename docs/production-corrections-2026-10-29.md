# Scoped Production corrections — 29 October 2026

Applied SQL migration 20261029154453_correct_checklist_and_production_variant_relationships, following the owner's instruction to resolve these Production issues before other ER findings.

## Accountability and checklist correction

The earlier lab-dip migration renamed the legacy lab_dip_status relation and retained its existing references from production_checklist. That was a dependency-review oversight: the checklist should reference item_status_list as drawn. All four checklist status FKs now reference item_status_list. There were no checklist rows/status values to reinterpret. Item entry now includes the four optional checklist statuses, reviewed before saving, and saves a single linked checklist record per item in the local preview.

## Live database changes

- job.verify_employee_id is NOT NULL, with its existing employee FK. No existing jobs/verifiers were invented; job table was empty.
- Each stage execution remains a separate job row. A trigger rejects changing the stage of an existing job. Creating the next job and copying its inputs will be implemented by the future verified handoff command; this migration does not claim that command exists.
- design_per_job renamed variant_item_per_job, with variant_item_id referencing variant_item. stage_pieces now uses variant_item_per_job_id.
- challan_job_item_pieces now references variant_item_id. Deferred integrity checks ensure job/part/variant/size relationships agree.
- stage.pp_stage added, with a check excluding tracked production pieces on PP stages. stage_pieces now has whole non-negative pieces_stock_in/out, output default 0. The old output field was renamed only after confirming no live piece rows required interpretation.
- variant.share_weight is required, positive and finite, default 1. No named variant rows existed during migration.
- job_assignees created using job_id + assigned_employees_id exactly as the revised ER, unique as a pair, with employee FK, RLS/default-deny and timestamps.

Employee reference validity and non-nullability are enforced. This is not the same as proving employee identity on each update; the authenticated/shared-link verification flow and transaction command remain part of the upcoming Jobs implementation. No bypass or anonymous mutation endpoint was added.

## Local item-entry changes

Variant cards have an explicit share-weight input and the Add variant button is at the section's top right. Review shows allocated pieces for every size and variant, as well as the item's Production checklist. 1:1 divides 100 into 50/50; 1:1:1 divides it into 34/33/33. Largest-remainder allocation preserves whole-piece totals, with card order breaking ties; the rule is shown at review. Weights are required and cannot be zero/negative/non-finite. Allocation is a reviewed derived plan, not an extra independent stock total.

Item part selection remains a dropdown. Its lab-dip/edition selection is optional and constrained to the item's brand. The browser Production model now uses canonical variant, variant_item, variant_item_per_job and stock field names. Legacy browser records are converted while preserving existing IDs/counts; legacy colour-only information is retained as legacy_color_map_id, not silently converted to a guessed lab dip. Older samples lacking a verifier are retained as legacy local records, but saving a job requires choosing a verifier. No real database verifier was fabricated.

## Verification

85 application tests plus lint, unused-code/duplication checks and production build passed. Rollback-only database fixtures verified verifier non-nullability, checklist FK targets, unique assignees, positive weights, zero initial output, PP stage piece exclusion, blocked existing-job stage changes and cross-part link rejection. All fixture jobs/items rolled back. Security checks found no warnings for the new trigger functions. Screen-table catalogue was updated/tested (75 relations, 431 mappings). Browser review verified an unsaved two-variant 100-piece plan displaying 50/50 and the checklist section.

## Deliberately deferred

Kanban overhaul, automatic next-stage job creation/input copying, direct-link employee validation, status history and mandatory discard/replacement of prior challans remain future work. Other ER findings are not changed by this scoped correction. Business UI remains local sample persistence until the live business API is implemented.

## Follow-up: equal shares and document checklist statuses

Applied 20261029155621_equal_variant_shares_and_checklist_document_statuses. Owner requested every variant remain share_weight=1 for now, with no user input. The item editor and standalone variant editor no longer expose the weight; save paths set 1, the database default is 1, and a temporary pilot CHECK enforces equal shares. Item review continues to show per-size whole-piece allocation with totals preserved.

Renamed tna_acquired_status_id to **techpack_aqcuired_status_id** using the owner's exact spelling, preserving existing values/FK. Added ordersheet_acquired_status_id with the same item_status_list FK. UI labels are Techpack acquired and Ordersheet acquired. Added Disputed once to item_status_list; it is available in job and checklist selectors. Legacy browser checklist values migrate from the old field without discarding them. No lab-dip status definitions were changed.
