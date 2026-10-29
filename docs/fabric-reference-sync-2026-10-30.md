# Fabric reference and dyeing sync — 30 October 2026

The database already has the correct mandatory contact links, program version FK and batch mapping table. This update changes UI/model code to match it; no additional schema migration was needed.

## Completed

- Brands capture brand, contacts_id and contact_purpose_id. The sheet/overview includes company and purpose.
- Suppliers capture an existing contact or explicitly create a new company, plus the required contact purpose. Supplier type remains fixed during edits. Existing shared contact IDs are retained; no purpose IDs are guessed.
- Program colour sections include exact lab-dip version selection, with labels for edition, version, date and status. All versions for that mapping/dyer are selectable; a colour/dyer change defaults to the newest accepted version (Approved, Approved with comments or Attached Swatch), and clears an incompatible previous batch. Opening an existing program preserves its saved selection.
- Program persistence stores lab_dip_version_id, never color_map_by_brand_id. The latter is a draft/display selection derived through lab_dip_version → lab_dip → colour mapping.
- Previous batches match the exact selected version and cannot be the program line's own output.
- Dyed output persistence stores batch in batch_no_lab_dip_version_map with dyed_fabric_item_id and the originating program's lab_dip_version_id. The form's batch input explicitly declares its separate storage table/FK. Mapping IDs survive edits; duplicate batch numbers, broken references and partial invalid updates are rejected by the local model.
- Yarn/knitting/dyed reports, stock fabric selectors and batch traceability read the canonical mapping. Costs and balance formulas are unchanged.
- The default fixture uses canonical fields. A dedicated local legacy converter preserves IDs/counts and old version-1 references, never upgrades an old program to a newer approval automatically. Missing contact links are marked for completion, not assigned to invented contacts/categories. No legacy conversion writes to Supabase.

## Verification

95 application tests, lint, unused-code, duplication and build checks pass. The read-only live database contract test confirms mandatory links, absence of obsolete columns, batch uniqueness and consistent stored program/batch versions. Browser checks verify the brand link inputs and exact-version program form/review without changing saved sample data.

The coherence checker validates grouped fields and separately mapped batch input storage, including its FK to dyed_fabric_item and reviewed screen/table write mapping. Brands, Suppliers and Fabric's batch fields now pass. The remaining checker failure is the existing raw-material receipt order-line input, which is outside this fix.

## Still required before live business entry

This remains the local business preview; there is no claim that these document forms save to Supabase yet. The next integration must supply permission-scoped database reads, bigint IDs as strings, database-generated document numbers, guarded atomic parent/detail/batch save commands, stale-edit/balance/concurrency validation and record-scoped attachments. Shared sheet formatting still needs shared database persistence. These are integration/release tasks, not reasons to restore the obsolete Fabric field names.

The earlier readiness audit remains historical; its F02–F06 UI/model findings are resolved by this update. Its live persistence/transaction/formatting findings remain open. A live connection test should start with read-only lookup/document loading, followed by rollback/controlled-write tests of the guarded commands.
