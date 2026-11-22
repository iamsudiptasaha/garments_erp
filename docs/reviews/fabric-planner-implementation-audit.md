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

Remaining limits: existing snapshot is unpaginated; no new server read API or migration. Sheet grouping has aligned subtotal rows but no shared collapse control. Browser account tests use a synthetic RPC adapter; real preference RLS is separately tested in PostgreSQL. No claim of production deployment or live business-save acceptance.
