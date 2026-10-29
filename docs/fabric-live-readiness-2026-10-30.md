# Fabric live readiness — 30 October 2026

**Update:** F02–F06 UI/model mappings are now resolved; see [reference sync](fabric-reference-sync-2026-10-30.md). Live persistence and server-side release gates remain open.

**Result: NOT ready for live business entry.** The storage/account services are live, but a signed-in Fabric page still reads/writes local sample data. This audit is not approval to deploy the business module.

## Scope traced from the database

31 tables are in the outgoing FK dependency closure of Fabric/Colours. This includes brands, shared contacts, contact categories, employee identity required by attachment metadata and their lookup dependencies—not just the Fabric sidebar entries.

- Purchasing/receipts: yarn_purchase_order, yarn_purchase_order_item, yarn_bill, yarn_bill_item, yarn_supplier, yarn_type.
- Knitting: knitting_bill, knitting_bill_item, knitter, fabric_type, fabric_status_list.
- Dyeing: dyeing_program, dyeing_program_item, dyed_fabric_bill, dyed_fabric_item, dyer, batch_no_lab_dip_version_map.
- Colours/brands: color_map, color_map_by_brand, lab_dip, lab_dip_version, lab_dip_version_status, brand_list.
- Shared records: contacts, contact_purpose, employee, gender, blood_group, type_of_employment.
- Files: attachments, bucket_group; plus private access/file route/upload command tables and Auth identity.
- Non-FK dependencies: document_number_counter, database number/default/timestamp/traceability triggers; view_knitted_fabric_name, view_default_lab_dip_version, view_variant_item_lab_dip_status.
- Incoming references were also inspected: buyer_list/item use brands; variant_item uses lab dips; raw_material_check_in uses dyed fabric; contact details/bank accounts use contacts; jobs/challans/stock use employees; file routes/upload history reference the registry. These remain protected downstream boundaries, not an instruction to release those business screens now.

## Confirmed release blockers

| ID | Finding / evidence | Required implementation |
|---|---|---|
| F01 | Fabric's load/save in src/fabric/app.js still uses localStorage; live=1 only adds authentication. | A distinct live repository; no sample fallback on network/auth/schema errors. Real saves, reloads and error states. |
| F02 | brand_list requires contacts_id and contact_purpose_id. Brands form captures brand only. | Capture/select both links, create/reuse the contact explicitly, save transactionally. Keep brand IDs stable. |
| F03 | yarn_supplier, knitter and dyer require contacts_id AND contact_purpose_id. saveSupplier only supplies contacts_id. | Include contact purpose in the role form/command; no guessed category ID. Preserve shared contact identity on edits. |
| F04 | Program form/domain still persists color_map_by_brand_id on dyeing_program_item; DB now requires lab_dip_version_id. | Colour/brand + dyer select eligible edition/version. Default latest accepted from DB view, allow explicit version. Persist version FK; derive colour from it. |
| F05 | Prior-batch selection is colour-only in batchesForMapping. DB requires exact lab-dip version match. | Filter prior batches by selected version, including dyer consistency; clear dependent choice on version changes. |
| F06 | Dyed bill form/domain still writes batch_no to dyed_fabric_item. DB moved it to batch_no_lab_dip_version_map. | Atomic parent/detail/batch-map command, UNIQUE batch and dyed-row mapping, same version as program, safe edit/delete references. |
| F07 | Number triggers always generate YPN/SCD numbers; UI currently requires manually entered numbers. | Database-generated display values, returned after save. Never invent production counters in the browser. |
| F08 | Local saveDocument clones/replaces whole detail arrays; no database transaction or stale-version check. | Allowlisted per-document commands; row locks/version checks; forbid line stealing and deletion of consumed/referenced sources. |
| F09 | Consumption/balance rules currently run in JavaScript. DB has no equivalent numeric constraints for most Fabric quantities/rates. | Server-side finite/nonnegative validation, source balance checks and concurrency locks. Test two simultaneous consumers; preserve totals on failed edits. |
| F10 | Local data uses UUID strings, real PK/FKs are bigint; date may be nullable/timestamptz. | Server returns bigint IDs as strings before JSON precision loss; correct null/date/timezone handling, no .slice on nullable dates. |
| F11 | Live file service is separate; bill/lab editors still use generic attachment IDs/local arrays. | Embed record-scoped upload/read controls after real parent save; no cross-group employee-document metadata in Fabric pickers. Upload to an unfinished lab version before closing its edition. |
| F12 | Sheet formatting/preferences currently live only in browser localStorage. | Shared database persistence under format permission with conflict handling, as previously requested. |
| F13 | Local validators impose some stricter rules than DB (e.g. invoice number matching); DB allows nullable quantity fields. | Explicitly document intended business constraints; retain existing agreed costing until validated with a real example. Do not silently convert unknown quantities to zero. |
| F14 | Bill/source selectors are unfiltered full local arrays and no live pagination/query behaviour exists. | Permission-scoped minimal lookup projections, reference filtering, bounded search and loading/error states. Brands, contacts and contact categories must be included. |

## Security finding and completed remediation

The initial audit found 25 related tables without RLS, with anonymous CRUD grants, and 25 callable legacy Supasheet security-definer functions. The user confirmed **portal only; secure these tables**. Migration `secure_fabric_dependencies_for_portal_only_access` enables RLS and revokes browser/PUBLIC direct access on all 31 dependency tables and the three derived views; the non-FK document_number_counter dependency is protected by a follow-up migration. Legacy Supasheet schema usage and function execution are revoked from PUBLIC/anon/authenticated. These interfaces are not needed by this portal.

Verification confirms no remaining anon/authenticated direct table privileges in the scoped set and no anonymous Supasheet function execution. Existing guarded account/file RPCs remain the supported access path; reviewed live Fabric commands must be created before any Fabric data access is granted back. RLS on these tables intentionally defaults to deny. This does not certify unrelated ERP/sandbox schemas as secure or production-ready.

## Other corrections made during audit

- Fixed unqualified fabric_status_list lookup in the default-status trigger; fixed search_path on the two number generators. This prevents lookup failure when invoked by guarded functions using an empty search_path.
- Lab-dip attachment labels now use actual attachments.filename instead of file_name; regression test added.
- User supplied yarn_count **24** for both 24'C Swan CCH and 24'C Shivam Premium CCH; saved as text '24', not inferred '24S'.

## Existing data audit

- No negative yarn balance, negative greige balance or missing dyed-row batch map found.
- No duplicate normalised contact company names found in current records.
- Two lab-dip versions have NULL status, retained as **Status not recorded**; never auto-approve them.
- One dyed-fabric row has NULL final_quantity; this is unknown, not zero. The DB allows it.
- No negative/nonfinite Fabric numeric values found in current records.

## Release acceptance evidence still needed

1. For every mapped screen, save against Supabase, reload in another session and verify parent/detail links, lookups and derived values.
2. Prove denied and allowed roles at RPC level (including shared brand/contact lookups and private attachment access).
3. Test a complete real-sized PO → yarn receipt → knitting → lab dip/version → dyeing program → dyed bill → batch trace chain, including partial consumption and edits.
4. Test simultaneous source consumption and stale edits; prove rollback leaves no partial parent/detail/batch/file links.
5. Compare yarn/greige balances, wastage and agreed final-price calculation across Overview, Sheet, export and print.
6. Confirm shared formatting survives another user's session. Keep unrelated unfinished screens out of the live release.
7. Pass coherence + quality checks, commit/review and select the deployment destination. No GitHub push or public deployment was performed by this audit.

The existing 90-test suite mainly validates the local model and file commands; it is not evidence of live Fabric persistence. The audit adds a filename regression test, making 91 local tests. The commit gate now also rejects the missing brand contact links and supplier contact-purpose input, as well as the two stale business fields. No findings are baselined away.
