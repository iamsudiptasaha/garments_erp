# Dyeing edition groups — approved implementation on dev

Migrations: `20261123200917_lab_dip_edition_groups.sql` and `20261123210053_fabric_requirement_integrity_boundary.sql`. This change has not been applied to hosted Supabase. No production deployment is authorized.

## Ownership and persistence

Brand-specific colour → Lab Dip edition/mixture → approval versions. `item_part_fabric.lab_dip_id` selects the edition. Approval never filters eligibility. `variant_item.id` still resolves style, shared variant and production part; its historical lab column is retained for compatibility but removed from the live writable contract and item editor. The requirement status view is `view_item_part_fabric_labdip_status`, keyed by `item_part_fabric_id`, not variant identity. Fractional consumption remains unchanged despite the diagram's integer annotation.

Program → `dyeing_program_lab_dip` → fabric items → composite M:N planner links. Each group explicitly owns edition/version and optional historical `batch_no_lab_dip_version_map.id`. Composite FKs enforce version membership and item/program ownership. Program+edition is unique; a shared transaction lock and deferred guard enforce six edition groups, including concurrent writes and replacement of a group within a transaction. Different editions of the same colour remain separate. Program items retain their program ID as an FK-checked ownership reference.

Previous batches must have the same edition, may have another version, and cannot originate from any item of the current program. Output batch mappings retain their original exact version. Recorded receipts block version/edition changes that would invalidate that provenance. Costing, automatic receipt identity/quantity, stock, coverage and production calculations are reused unchanged.

“Approved from Previous Program” is a reuse description, not another approval state. The editor identifies an edition already used by another program, reuses its ID, and explicitly selects a version. No edition, approval review or previous-batch selection is generated. The migration only renames a matching persisted label, preserving its ID and references; it inserts no new status. The audited live lookup had no matching persisted label.

## Atomic contract

The existing public `erp_save_fabric_document` and private core save header, groups, items and links together. Groups precede items; deletes run in reverse. Composite links are handled explicitly through their two actual keys, never a synthetic database ID. Existing links reopen selected; addition reviews retain the complete set and recalculate only affected ordered quantities from authoritative SQL requirement kg. Manual overrides afterward are preserved. Unlinking preserves the item's quantity and other rows. Removals are explicit and included in review.

Link mutations require program create/edit plus Production Items view; existing one-link Planner permissions remain unchanged. The private group table has RLS and no browser grants. Catalogue mappings inherit the existing program-item read permissions. Snapshots serialize all bigint references as strings. Group/item and link-set digests in `fabric_json` invalidate stale complete-document reviews even for link-only writes where the timestamp trigger correctly treats a header-only stamp as a no-op. The reviewed SQL total also rejects stale planner quantities. Requirement and one-link RPCs explicitly complete deferred integrity checks inside their existing authorized boundaries before returning to the authenticated caller. No private-table SELECT grant or SECURITY DEFINER trigger is introduced. Existing row/root optimistic checks, audit logging and dyed-bill attestation remain active.

Planner saves await the existing workspace refresh before closing, so the next program editor receives current link/group revisions rather than the previous cached Fabric snapshot.

Frontend sources: `program-editor.js` owns the document form; `program-model.js` stages group/item/link changes; `relationships.js` resolves persisted group ownership. The generic BillEditor program form was retired. `FabricRequirementFields`, shared selectors, Overview controls, preference store, native dialogs and `FabricSheet` remain shared. Only ordered kg opts into staged worksheet entry; all other cells and other worksheets remain protected.

## Database object changes

- New table: `dyeing_program_lab_dip`; new group FK on program items. New unique version+edition key supports the composite FK. No allocation/reservation table.
- New function: `guard_dyeing_program_group()` (one). New constraint triggers use the existing traceability/link functions. Net function count: **+1**.
- Modified: `check_lab_dip_traceability`, `check_fabric_plan_dyeing_links`, `fabric_contract`, `fabric_row_in_document`, `fabric_snapshot`, `fabric_planner_snapshot`, `save_fabric_document_core`, `set_fabric_plan_dyeing_link`, `production_setup_contract`, `fabric_json`, `save_fabric_requirement`.
- Replaced view: `view_variant_item_lab_dip_status` → `view_item_part_fabric_labdip_status`.
- Reused unchanged: `fabric_plan_coverage`, requirement and coverage/status views, receipt synchronization, verified bill APIs and costing/SKU functions. `view_default_lab_dip_version` remains a legacy report, never an automatic program selection source.
- Retired columns: item-level version and previous batch, after dependency replacement and full backfilled-graph guard verification. No `DROP CASCADE`; no historical migration edits.

## Release and recovery

Preflight locks source tables and fails on orphan/dyer/batch inconsistency, multiple versions/batches within a proposed group (including NULL disagreement), or more than six editions. Backfill preserves existing program/item/requirement/link/output-batch IDs. New constraints and guards validate the complete graph before old columns/view are retired. Any error rolls back the migration transaction. Conflicts require explicit reconciliation; no arbitrary “first/latest” choice is made.

For future approved release, apply this migration and its matching portal through reviewed GitHub Actions release gates in a maintenance window. The old portal cannot write the new item contract; do not serve mismatched releases. Keep a verified pre-release backup and original commit. Before new writes, transaction failure leaves the old schema intact. After successful migration, recover with a reviewed forward fix or coordinated backup restore through the deployment recovery process; do not blindly revert the portal after cross-version historical-batch selections exist. No hosted SQL/CLI application is permitted.

Tests cover empty replay, populated backfill/conflict rollback, version/edition integrity, six-group and uniqueness races, same-edition/different-version batches, own-program rejection, receipt protection, exact component identity, complete links, stale reviews/totals, atomic rollback, manual overrides, permissions, costing/stock regressions and Chromium document interactions. Browser fixtures test the actual components with synthetic transport; database tests independently exercise actual PostgreSQL transactions and two-session races. Neither establishes a production rollout.
