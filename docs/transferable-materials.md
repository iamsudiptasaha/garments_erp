# Transferable Materials

Development implementation of the approved `Fabric.drawio` misc ER and modal. Production release is not authorized. The migration and portal must be released together through reviewed main-branch GitHub Actions; no direct production SQL.

## Ownership and audited dependencies

One existing `raw_material_check_in` receipt is one indivisible transferable record regardless of its billed quantity. `is_transferable` defaults to false. No duplicate registry, piece records or stored status exist. Movement references the existing receipt, controlled movement type, `job_worker`, garment `item` and `employee`. Garment labels use the existing style code/product description.

Audited the current dev migrations and read-only production metadata: receipt/issue columns, the composite PO-line/material FK, SKU and automatic dyed-receipt triggers, database timestamp triggers, existing transaction/setup/snapshot RPCs, access/session functions and table grants. Production function bodies matched the current inventory command architecture. Production was not changed.

The existing `garments_erp.save_raw_material_transaction` and `raw_material_transaction_snapshot` are extended. Existing setup commands, quantity validation, category/SKU generation, checkout stage, automatic dyed receipts, private attachments and ordinary outward workflow are retained. The new guarded `record_transferable_movement` command appends events. Public RPC wrappers retain the existing restricted schema boundary.

## Database safeguards

| Requirement | Enforcement |
| --- | --- |
| PO material receipts only | `transferable_receipt_source` CHECK, existing composite PO/material FK; automatic/fabric receipts excluded |
| Enabling after any Stock Out | Receipt trigger checks retained issue history, including reconciliation; issue deletion/reparenting and truncation rejected |
| Disabling after any movement | Receipt trigger locks transferability and identity |
| No regular Stock Out/reconciliation | Stock Out table trigger covers old RPCs, direct writes and other inventory paths |
| Transfer/Return/Discard/Restore states | One database transition function consumed by the event guard and read projection; Transfer/Discard from In Stock, Return from Transferred, Restore from Discarded |
| Worker and garment assignment | Required Transfer FKs to `job_worker` and garment `item`; Return copies the active assignment; no worker-to-worker transition |
| Employee attribution | Required employee FK on every event; current account authorization is checked independently |
| Immutable history and receipt identity | Event UPDATE/DELETE/TRUNCATE rejected; receipt ID/SKU/source/quantity/date/category/flag locked after movement; restrictive FKs |
| Controlled types | Four fixed lookup pairs, immutable lookup triggers and no client table grants |
| Concurrency and stale review | Existing advisory lock `741208531`, statement locks before row locks, receipt lock, expected latest event and exact receipt revision; non-READ-COMMITTED writes must retry |
| Event order | Database replaces supplied IDs/timestamps, using monotonic `movement_at timestamptz` and database ID; current state derives from ordered events |
| Authorization and bypass | Existing enabled-account/session/AAL2/RBAC checks in RPC and event trigger; RLS enabled, direct movement grants revoked for browser/service roles, private helpers not executable |

Custom roles receive no new permissions automatically. Administration controls view/create/format/export/print independently. There is no movement edit/delete permission. As elsewhere in the ERP, the database owner can administer the schema; application roles cannot disable these guards.

## UI mapping

- Stock receipts retains its existing editor and Review/Confirm. Only the Transferable control and database lock messages/restrictions are added.
- Stock outward retains its editor, fields, route and save command; transferable receipt options are omitted. The table trigger also rejects reconciliation through any path.
- Transferable Materials is exactly one sibling page. Shared `OverviewTable`, `FabricSheet`, account preferences, search, filter/sort, stable receipt selection and protected worksheet values are reused.
- The approved material/SKU/quantity header, grouped state/actions and conditional assignment details use existing ERP classes. The chronological history table is retained. The frontend displays database-provided state, available actions and receipt restrictions rather than implementing a transition engine.
- Movement forms use linked-record selectors, employee attribution, existing Review → Confirm and readable database errors. Failed stale review remains visible and requires reload/review.

## Verification

`database/tests/transferable-materials.sql` covers transitions, missing/invalid FKs and attribution, stale/denied actions, history and receipt protection, direct Stock Out/reconciliation, flag restrictions, controlled types and database timestamps. Fixtures roll back.

`fabric-poc/integration/transferable-materials.mjs` verifies six competing independent-session operations, including both Stock Out/flag lock orders. `transferable-browser.mjs` uses real disposable Supabase Auth, TOTP and PostgREST, forwarding the existing HTTPS test origin to localhost without mocking business responses. It verifies Stock In/Out, repeat movements, stale errors, view-only permissions, both grids and desktop/tablet/mobile screenshots. It also checks Overview filtering and same-account preference restoration in a second browser context.

CI runs the invariant suite, concurrency tests and real database Chromium acceptance. Run the standard quality/coherence checks and full Chromium regression suite with the environment settings in `.github/workflows/verify.yml`.
