# Fabric Planner design-system gate — 22 November 2026

Validated against dev 001eddd and actual Colours render path in src/fabric/app.js, OverviewTable, RecordPageHeading/Actions, FabricSheet, GridSort/Columns, WorkspaceViewToggle, grid-preferences, navigation, shared/Colours CSS and browser contracts.

| Outdated or ambiguous rule | Correction |
| --- | --- |
| All configurable grids use FabricSheet | Explicit OverviewTable versus FabricSheet ownership |
| Generic worksheet toolbar applied to Overview | Scope sort/Columns/Zoom/export row to Sheet; Overview uses its own Filter/Group/Sort/Columns |
| Card typography treated as current record baseline | Retained dashboards only; Colours record lists use tables |
| Missing exact reuse and modal contract | Actual exports required; no copied controls; Customize columns belongs to Overview, Sheet retains disclosure |
| Undocumented primary action placement | RecordPageHeading action below right-hand toggle; RecordPageActions for Sheet |
| Export/print apparently mandatory | Independently capability-gated, no page-level duplicates |
| Shared data confused with shared presentation | Distinct per-account Overview/Sheet preference keys |

All Markdown component/path links in design-system.md resolve. Existing theme, tokens, shell, navigation, review/save, protected Sheet values and permission rules retained. Historical verification statements describe existing tests, not new release evidence. Native dialog size has an existing Overview-controls exception (580px); general record dialogs use 1000px. Dedicated Studio and retained dashboard cards remain scoped exceptions.

## Mockup comparison and resolved integration scope

Approved mockup uses actual controls. Its build transforms are not production APIs. Replace these with optional shared Overview initial preferences/render-body/controlled search and worksheet group-preserving row ordering, retaining defaults for all existing consumers. Keep Overview and Sheet sort/order/visibility independent. Colours retains its existing Sheet label; Planner may supply the approved Sheet View label through an optional toggle label.

Requirement identity remains item_part_fabric.id; variant_item.id resolves item_part → item/style/part_list and shared variant.variant_name. Component lab_dip_id resolves colour and exact edition. Live metadata and fabric_plan_estimates view were rechecked read-only: SQL required_kg, coverage and status are authoritative. The UI only sums already calculated kg once per requirement ID. No hierarchy removal, quantity formulas, stock allocation or new write boundary.

Reuse erp_fabric_planner_snapshot and existing requirement/link editor and RPCs. No migration is needed for the approved presentation. Existing snapshot is unpaginated: controls act on the loaded snapshot, disclosed in-page; bounded server reads remain a scalability limitation, not a silently introduced new API. Existing program-specific linking workflow is preserved unchanged. Move the ordinary Planner navigation entry to Production. Inspection stays separate from editing; Sheet has no extra sections below it. Actual consumption is only shown once per Variant + Fabric Type in source inspection.

Sheet has no existing shared colour-collapse control; preserve inline colour subtotals without inventing a toolbar. Overview colour groups collapse through the shared preferences. No other design deviations authorized.

Gate: documentation contracts and source mapping validated before implementation. Verification evidence will be appended after tests.

## Verification

- Full local quality command: PASS (17 coherence checks, typecheck, lint, formatting, unused-code/duplicate checks, 159 unit tests and build).
- Full Chromium suite: 121 PASS, 2 existing skips. Final focused Planner rerun passes after enforcing the identical filtered source set in both views. Colours visuals at 1440/1024/390, original Sheet selection/actions and production document navigation pass.
- Planner browser acceptance covers exact lab-dip filtering, dynamic columns, aligned colour/grand totals, duplicate-fabric sub-parts, named native Columns modal, numeric width and reorder/visibility, independent view preferences, reload/account isolation through the existing preference hook, read-only source IDs and source refresh. Screenshots captured in Playwright output.
- Disposable PostgreSQL snapshot: 19 individual requirements, exact parent/component-lab IDs and authoritative kg preserved. Existing grid-preferences SQL (including RLS, denied cross-account writes and anonymous access) PASS with rollback.
- The optional existing dyed-bill SQL regression could not run in the older populated review fixture because `Verification yarn` already exists; no production data was touched. Clean replay and the standard regression belong to the GitHub isolated database job.
- All 29 design-system path references resolve; git diff whitespace check passes.

Remaining limits: existing snapshot is unpaginated; no new server read API or migration. Sheet grouping has aligned subtotal rows but no shared collapse control. Browser account tests use a synthetic RPC adapter; real preference RLS is separately tested in PostgreSQL. No production deployment or production business saves were attempted.

### Real database browser integration

The first GitHub run passed clean schema replay, SQL sub-part/status/costing/receipt regressions and the regular quality/browser/security/CodeQL jobs, then exposed a retired Planner selector in the existing real-database browser workflow. Updated only that Planner test path: creation through the existing Item editor, read-only Planner source inspection, then explicit editing. The full test passes locally against real disposable Auth, PostgreSQL, private Storage and the Files handler, including fractional consumption, exact component dips, Review/Back/Confirm, status overrides, Draft/Final linking and unlinking, verified receipt and automatic inventory. No test assertions or CI gates were bypassed.

Final sorting check: colour groups now follow descending colour sort in each view, while subtotals remain with their colour and the grand total remains last. Added unit and Chromium regression coverage; full quality and 121-browser-test suite pass again.

## Completion audit — 23 November 2026

Baseline: ca3d060. Rechecked the approved mockup, canonical design reference, actual shared Colours components, snapshot SQL and requirement projections. One remaining regression was confirmed: removing Overview colour grouping hid the headings but retained colour-block ordering. The Planner body now respects the shared table's global sort when ungrouped; enabling grouping restores aligned colour subtotals. Sheet grouping and its independent configuration remain unchanged. No controls, calculation engine, ownership boundaries or database objects were added or replaced.

Added Chromium regression coverage for grouping removal, global descending sub-part sorting, preference reload, independent Sheet grouping and regrouping. Extended the real database browser workflow to export the actual Sheet and compare its filtered dynamic fabric columns and grand totals with PostgreSQL fabric_plan_estimates after a reviewed edit. Source identities, exact component lab dips, permission denials and existing editing/link/receipt workflows remain covered by the existing acceptance tests.

Verification: quality PASS (159 unit tests, 17 coherence checks, typecheck, lint, format, duplicate/unused checks and build); complete Chromium suite 122 PASS, 2 existing skips; disposable database preference/RLS rollback tests PASS; real Auth/database/Storage browser Planner workflow PASS. No pagination changes, Items/Dyeing redesign, migrations or deployment. Remaining limitation: Sheet has no existing shared colour-collapse control; aligned subtotals remain inside the worksheet. Existing snapshot read scope is unchanged.

## Fabric Status finalization — 23 November 2026

Rechecked the approved Planner layout and canonical ERP component contracts. Fabric Status now follows all dynamic fabric-type columns by default in both views. It uses the existing snapshot lookup of fabric_plan_estimates.item_part_fabric_status_id for each item_part_fabric.id, including the authoritative manual override. Database labels are preserved verbatim, including “Reused in-house fabric”. Overview uses the existing erp-overview-status chip; Sheet uses its standard protected text cell. Totals have blank status cells. Existing hide/reorder/width preferences still apply independently.

Overview's actual shared Filter supports Fabric Status AND rules; the resulting filtered requirement set is also supplied to Sheet. Sheet retains the approved existing search/sort/Columns controls without a new Filter dialog. Each view sorts Fabric Status independently. No new status calculations, override rules, writes, permissions or database objects were introduced.

The expanded real-database acceptance caught a second filtering pass in Overview masking the pending shared debounce. Added an optional pass-through to TanStack's manualFiltering option, enabled only for this already-filtered Planner dataset. Both views now display the same authoritative filtered records. Ordinary ERP Overview consumers retain their default behaviour. This is documented in the shared extension contract; no toolbar or layout changes were made.

Verification includes all five statuses, blank subtotal/grand-total cells, same-parent and same-fabric requirement separation, exact-ID source selection after status sorting, status filtering with dependent fabric columns/totals, hiding/reordering and independent preferences. Real database Chromium checks compare both visible Overview labels and Sheet exports to SQL by requirement through manual override/reset, Draft/Final links and verified receipts. Local quality: 160 unit tests and 17 coherence checks PASS; complete Chromium suite and real database acceptance pass. Final CI is checked on the pushed commit. Existing snapshot scope and lack of a shared Sheet collapse control remain unchanged; no pagination changes, migrations, Items/Dyeing redesign or production deployment.
