# Fabric: database-first alignment before going online

Scope: Fabric, plus colour/lab-dip dependencies required for dyeing. Production and stock workflows remain separate. Supabase is authoritative; the browser preview is not a second schema.

## Findings from current source and live metadata

1. **Dyeing program persistence is stale.** `fabric/domain.js` still saves `color_map_by_brand_id` and validates prior batches by colour. Current database `dyeing_program_item` stores the selected lab-dip version; prior batches must match the exact version. Colour/brand is derived through that version's edition. Reuse latest accepted default selection, allow explicit version selection, preserve an already saved selection.
2. **Output batches use a separate mapping.** The form/domain still put `batch_no` on `dyed_fabric_item`. Current database stores it in `batch_no_lab_dip_version_map`, linked to the dyed-fabric row and its lab-dip version. Save both in one guarded database transaction; editing must not orphan or duplicate the mapping.
3. **The UI is still a local store.** `saveDocument` returns local arrays and UUIDs. Live Fabric must read database IDs, preserve bigint IDs as strings and save parent/detail rows atomically through explicit adapters/commands. `?live=1` currently controls login/access only.
4. **Old colour/edition compatibility fields remain in local seeds.** They must remain a clearly isolated local upgrade adapter, never be spread into live database writes. Colour mappings no longer own the dyer or shade-card approval fields.
5. **Files now have a live service.** Saved-record file page and bucket administration are connected. Bill attachment controls must be embedded after the parent is saved. Shade-card image attachments need an explicit allowed slot/group decision; existing service target list currently excludes them.
6. **Authorisation is not yet ready for a live Fabric module.** The advisor reports legacy exposed application tables without RLS. Check actual grants, enable table policies or use guarded commands with direct writes revoked, and prove denied read/write cases for the Fabric dependency chain. The new file ledger remains default-deny. Unrelated legacy Supasheet issues are outside this pass.

## Screen contract / implementation order

| Screen | Authoritative tables | Write/read requirement |
|---|---|---|
| Suppliers | contacts + yarn_supplier / knitter / dyer | Preserve shared contact identity and role mapping |
| Yarn / fabric types | yarn_type / fabric_type | Exact column names; yarn_count drives derived name |
| Yarn purchase orders | yarn_purchase_order + yarn_purchase_order_item | One parent, many lines; source references preserved |
| Yarn bills | yarn_bill + yarn_bill_item | Receipts reference exact order lines |
| Knitting bills | knitting_bill + knitting_bill_item | Consume source yarn; read view_knitted_fabric_name |
| Colours / lab dips | color_map, color_map_by_brand, lab_dip, lab_dip_version, lab_dip_version_status | Edition lifecycle and exact-version selectors |
| Dyeing programs | dyeing_program + dyeing_program_item | Dyer, version and optional prior batch validated together |
| Dyed bills | dyed_fabric_bill + dyed_fabric_item + batch_no_lab_dip_version_map | Atomic unique output batch and matching version |
| Dyed fabrics / balances / traceability | Joins over the chain above | Derived read models; no duplicate editable totals |

## Acceptance gate for each screen

- Read contract: table/view, selected columns, joins and stable row ID.
- Write contract: allowlisted fields, defaults, nullable fields, parent/detail FKs and transaction boundary.
- Field names in stored payloads match DB; derived display aliases are explicitly named as derived.
- Role, stale edit and reference/deletion checks run on the server.
- Tests cover insert, edit, reload, dependent names/balances, concurrent conflict and rejected access.
- Compare saved quantities and reports with a small realistic yarn-to-dyed job before enabling staff writes.

The offline coherence gate currently blocks the two declared stale field references (dyed batch and an out-of-scope stock receipt order-line field). This is intentional; no baseline suppresses them. The audit also identifies workflow drift that a column-name check alone cannot establish. Do not declare Fabric live merely because the naming check passes.
