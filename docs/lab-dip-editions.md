# Lab-dip edition migration — 29 October 2026

> Historical implementation record. Current approved edition-group ownership and release/recovery rules are documented in [Dyeing edition groups](dyeing-edition-groups.md). Earlier variant-colour, item-level version/batch and automatic approved-version selection descriptions below are superseded.

Applied migration: `20261029140713_lab_dip_editions_variants_and_batch_traceability` in project kidvckaicclqvtlddeyz. UI unchanged in this database-only step.

## Structure

- `color_map_by_brand` is unique by colour + brand. Dyer and shade metadata moved into lab dips/versions.
- `lab_dip`: colour mapping + dyer + positive edition, unique as a triple.
- `lab_dip_version`: positive sequential version per edition, date, shade-card fields, attachment FK, comments, status FK, attached-swatch flag.
- `lab_dip_version_status` replaces the empty old `lab_dip_status` lookup. Existing checklist foreign keys continue to reference the renamed relation; their names/columns are unchanged.
- Existing `variant` mapping renamed `variant_item`; `design` renamed `variant`, and its name column is now `variant_name`. `variant_item` stores item part + variant and optional `lab_dip_id`, with colour/brand/dyer derived through that edition. Existing `design_per_job` and challan `design_id` column names remain per the diagram; their FKs follow the relation rename.
- `dyeing_program_item.lab_dip_version_id` is required. Optional `batch_no` refers to an earlier batch using that same exact version. Program dyer must match lab-dip dyer.
- `batch_no_lab_dip_version_map` owns globally unique batch numbers, one mapping per dyed-fabric item, with repeated lab-dip-version IDs allowed. Batch and originating program versions must agree. A program cannot use its own output as the prior batch.
- `variant_lab_dip_legacy` retains the empty obsolete manual-status table; it is not used for new status output.

## Lifecycle and views

Versions start at 1 and advance by one, serialised with a parent-row lock. Only the latest version can be updated; an accepted version closes the edition. Attached Swatch, Approved with comments and Approved all close it. Completed editions cannot receive, change or delete versions; create another edition instead. The attached-swatch boolean must match the Attached Swatch status. Edition identity cannot change after versions exist.

`view_variant_item_lab_dip_status` derives status from the latest version of the selected edition. It handles no selection, no versions, missing legacy status, redo versions with pending/failed status and final acceptance. No previous-attachment-history logic is introduced. `view_default_lab_dip_version` chooses the latest dated accepted version for each colour-brand mapping and dyer, with edition/version/ID tie breaks; all versions remain manually selectable.

Both views use security_invoker. New tables and renamed lifecycle tables have RLS and no browser grants/policies, intentionally default-deny until live business access is implemented. No broad authenticated access was added. Trigger functions are invokers with fixed search paths and no public/browser execute grants.

## Existing data

Preserved: 2 colour-brand mappings, 2 dyeing-program lines, 1 dyed-fabric item and its batch `235C/26-27`. Created 2 edition-1/version-1 legacy references from the actual colour/dyer/shade-card data. Approval status remains NULL, shown as Status not recorded; no approval was inferred. Legacy image strings were NULL. Migration refuses ambiguous duplicates or non-null legacy image strings instead of inventing attachment records. Variant/name/manual-lab-dip collections were empty.

## Verification

`database/tests/lab-dip-editions.sql` ran against the migrated database with rollback-only fixtures. Verified version numbering, pending redo output, no-selection output, approved output/default, closure for all three accepted statuses, blocked edits/renumbering, unique batch numbers, many distinct batches reusing one version, and rejection of batch/program mismatches. All fixture rows rolled back (identity sequence gaps are normal).

Screen/table catalogue updated to 73 relations / 419 mappings. Catalogue tests pass. Security advisor comparison found only expected default-deny RLS/no-policy information on the new/renamed tables; no new security warnings. Existing unrelated project findings were left unchanged.

## Operational details

Create each new dyed-fabric item and its batch mapping in the same transaction: deferred consistency triggers require the pair at commit. Current triggers perform global consistency checks; appropriate for the small pilot, but should be made row-targeted before large-volume live rollout. A browser alone must not orchestrate separate inserts pretending to be atomic; use the future guarded transaction API.
