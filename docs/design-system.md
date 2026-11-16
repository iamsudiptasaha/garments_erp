# ERP UI design reference

This is the canonical design reference for every ERP screen. Read and follow it before designing or modifying an ERP screen or mockup. Use the Colours workspace, especially Lab dips, as the visual baseline for document and record screens. The running workspace and its CSS cascade take precedence over historical screenshots. [Workspace entry](../fabric-poc/src/fabric/app.js)

## Colour and themes

The shared workspace uses a light blue and white palette. The shared stylesheet defines `--erp-text`, `--erp-surface`, `--erp-border`, `--erp-primary`, `--erp-focus`, `--erp-view-background`, `--erp-card-radius` and `--erp-card-inset`. Reuse the existing classes to inherit the tokens and responsive rules. [Shared stylesheet](../fabric-poc/src/fabric/styles.css)

| Role | Existing value and selector |
| --- | --- |
| Workspace text and surface | `#243e53` and `#fff` on `:root`; `.fabric-main` is white |
| Secondary text | `#8295a6` in page subtitles, `#728a9d` in field labels, `#7892a7` in status notes |
| Navigation | `#edf6fe` to `#f1f6fc` sidebar gradient, `#dbe6f1` divider; hover `#e2eef9`; current page `#d4eafa` with inset 3px `#6aa7d2` accent |
| Actions | White neutral button, `#dce6f0` border, `#edf5fd` hover. `.primary` is `#357fb7` with white text and `#286c9e` hover |
| Focus and fields | 3px `#7bbcf1` outline with 2px offset on buttons, fields and summaries; field border `#d9e4ee` |
| Document grouping | `.fabric-line` `#f1f6fb`; Lab detail `#f5f9fc`; Lab record table header `#edf5fc` with `#63829b` text |
| Semantic status | Lab current `#dcedfc` / `#226b9b`; accepted `#e5f3ea` / `#33724f`; failed `#fff0e9` / `#a35237`; form error `#fff0ed` / `#ad4f43`. Use a text label with colour. |

Colours status and shade colours serve different purposes. A shade swatch represents record data. A status pill describes workflow state. Keep each meaning in its established component. [Colours styles](../fabric-poc/src/colours/styles.css)

The Production Task Board Studio is a separate exception with local `--purple: #7862da`, `--line: #e9eaf0`, `--muted: #9295a5` and `--ink: #343746`. The standalone spreadsheet demos use root `--paper`, `--ink`, `--muted`, `--line`, `--green`, `--soft` and `--selected`. The final demo override includes `--ink: #243c50`, `--line: #d9e5ef` and `--green: #357eb5`. These palettes are scoped to their existing surfaces. Use the workspace light palette for ERP record screens. [Studio styles](../fabric-poc/src/production-task-board/studio.css) · [Spreadsheet demo styles](../fabric-poc/styles.css)

## Typography and layout

The shared font stack is Inter, Apple system font, BlinkMacSystemFont, Segoe UI, then sans-serif. The page title is 29px/600 with −0.6px tracking, subtitle 12px, and eyebrow 10px/600 with 0.13em tracking. Overview cards use a 23px/600 title and a 12px subtitle. Editor headings use 23px and line headings 17px. Controls are 13px, sidebar links and compact tables 12px, and field captions and table headers 11px. Sidebar group headings are 13px/600. [Shared typography and layout](../fabric-poc/src/fabric/styles.css)

The workspace shell has a 235px sidebar and 34px × 38px main padding. Page headings have a 20px internal gap and 27px bottom margin. Action rows use 10px gaps, card grids 18px, and two-column editor fields 16px. The sidebar is sticky with its own scroll region. At 1100px and below it narrows to 205px and main padding becomes 25px. At 700px and below the shell stacks, main padding becomes 20px × 15px, headings and toolbars wrap, form fields stack, and dialogs use 20px padding. Colours has an additional 650px breakpoint for Lab content. Wide tables scroll inside their own container. [Workspace breakpoints](../fabric-poc/src/fabric/styles.css) · [Lab breakpoints](../fabric-poc/src/colours/styles.css)

## Controls and reusable sources

| Pattern | Use and exact source |
| --- | --- |
| Navigation | Use the [shared workspace sidebar and menu toolbar](../fabric-poc/src/access/navigation.js) on every ERP workspace screen. Keep the same branding, account footer, ordered sections, and destinations for the same signed-in account. Provide the current destination and existing route handlers to the shared component. The icon is an inline 20px SVG with currentColor and 1.7px stroke, hidden from assistive technology beside its text label. |
| Buttons and tabs | Shared buttons have 8px radii and 10px × 14px padding. Disabled controls use 0.45 opacity. Use `.primary` for the main action and [WorkspaceViewToggle](../fabric-poc/src/fabric/view-toggle.js) for Overview and Sheet. `.fabric-view-toggle` uses 9px radius, 4px inset and white selected buttons with `0 1px 5px #25445b10` shadow. [Controls CSS](../fabric-poc/src/fabric/styles.css) |
| Inputs and dropdowns | Label controls and use `.fabric-fields`. Native fields have 7px radius and 10px × 12px padding. Use the existing [RecordSelect](../fabric-poc/src/fabric/record-select.js) for richer relational options and [LabRecordSelect](../fabric-poc/src/fabric/lab-record-select.js) as the searchable picker example. |
| Tables and sheets | Use a semantic table in `.lab-record-table-wrap` for compact record lists. Cells use 11px × 12px padding and `#e4edf5` horizontal dividers. Use [FabricSheet](../fabric-poc/src/fabric/sheet.js) for sheet workflows. Its 600px frame has a 1px border and 10px radius. |
| Legacy Overview cards | Existing sections awaiting migration use `.overview-grid` and `.overview-card`, with 15px card radius, 25px padding and subtle `0 3px 12px #416d8a04` shadow. [OverviewPanel](../fabric-poc/src/overview/panel.js) |
| Forms and dialogs | Group document lines with `.fabric-line` (22px padding, 10px radius) and align actions with `.editor-actions`. Native `.fabric-dialog` uses 15px radius, 28px padding, 90vh max height, width `min(1000px, 94vw)` and `#17344966` backdrop. Follow [LabEditor](../fabric-poc/src/colours/editor.js) and [BillEditor](../fabric-poc/src/fabric/editor.js) for heading, fields and actions. |
| Print | Use the workspace print rules as the starting point. Keep the record and hide navigation and interactive controls. [Print CSS](../fabric-poc/src/fabric/styles.css) |

Navigation disclosures share stable section keys across signed-in workspaces. Persist each explicit expand or collapse through the shared account preference store. Keep the current-page indicator and responsive sidebar visibility independent of disclosure state. Verify the sidebar across workspace routes using the same account, including an account with restricted permissions. [Navigation regression checks](../fabric-poc/e2e/navigation-preferences.spec.js)

Use the existing workspace route handler for internal navigation so the application shell stays mounted. Challans, Worker Bills, Administration tabs, Files, and Bucket Groups retain their bookmarkable URLs and open in the authenticated workspace. Sign-in, recovery, and security setup use the account entry document. Update Tasks and direct floor QR links use the same handover form. ERP Update Tasks offers manual task selection, and QR links supply the task through the existing URL parameter. Keep real links for deep links and standard browser link actions. Verify browser Back and Forward, direct entry, permissions, and document and shell identity when adding a workspace route.

## Mandatory review before saving

Every ERP create or edit form, including full-page editors, dialogs and attachment mutations, follows **Enter Data → Review → Confirm Save**. Enter and the primary form action validate and open the review. They must never write a record, reserve an upload, or change a relationship. Back to edit restores the same inputs, selections and staged files. Closing review before confirming leaves server data untouched.

Build review from the normalized payload that will be submitted. Use readable names for related records. Show all entered values, line items, size quantities, previous and proposed values, additions and removals, and calculated totals. Label estimates when the authoritative calculation runs on the server. Show each attachment action and its filename, size and destination field. Keep passwords, recovery codes and authenticator secrets out of summaries.

Only Confirm save may send the reviewed payload. Disable repeated confirmation during the write and reuse the request ID on retries where the RPC supports idempotency. Keep review and its inputs available after failure. The server still checks current authorization, revisions, ownership and business rules. Where a file requires an existing record ID, review and confirm the record and attachment as separate operations. Never present a later upload as part of the record transaction. For a saved attachment slot, review the current link and the proposed action. Start staging only on confirmation, reuse the staged request on retry, and check the reviewed link on the server before replacing or removing it.

Verify create and edit, back and cancel, validation failure, repeated confirmation, retry, attachment access and upload failure, and review layout at desktop and phone widths.

## Record grids

Use FabricSheet for configurable record grids. Use GridSearch for labelled, debounced search with no separate submit button. Keep existing server search semantics and label exact matches explicitly. If a grid sorts or filters a server page locally, disclose that scope next to the controls.

Place search above the grid and the sort column, direction and row count on the next row. Keep the access note at the start of the action row and align Columns, Zoom, Export CSV and Print / PDF on the same baseline. Let controls wrap on narrow viewports and keep horizontal scrolling inside the grid.

Measure column content against the available viewport. Keep stable column keys and store explicit width overrides in pixels. Use the Columns control for order, visibility and width. A blank width restores automatic fitting. Export and print use the visible column order and the existing capability checks.

Use the shared grid preference store with a stable screen-specific grid key. Persist presentation settings per authenticated account and keep sample settings in browser storage. Preserve record and formatting permissions. Use RecordGrid for the Administration account list and Files configuration tables. Keep their row actions available when users hide columns. The Production Studio portal uses the same preference store for its TanStack layout and named views. Compact detail tables and editor matrices follow the parent document’s layout.

Verify reload, isolated browser sessions for the same account, account isolation, both sort directions, and toolbar wrapping on desktop, tablet and phone.

### ERP Overview tables

Use the shared TanStack `OverviewTable` for Overview card migrations. The Overview is a compact browse and open surface. Sheet is the existing worksheet for selection, formatting, export, print and its existing record actions. Keep the top-right Overview/Sheet toggle. Put the existing permission-controlled Add action directly below it in Overview. Use the ERP light palette for Table controls and dialogs.

- Supply existing authorized records and stable record IDs. Choose a minimal set of default columns with the record name or number first. Use stable column keys, fit content and fill the available width by default. Offer optional visibility, reordering and width overrides. Keep the identity column available for opening the record.
- Use the shared grid search and account preference store with distinct Overview and Sheet keys. Restore search, filter rules, grouping, sort, visibility, order and widths for each authenticated account. Use labelled debounced search, ordered sort rules and header sorting, AND filters across configured columns and collapsible grouping.
- Render statuses with readable labels on subtle ERP chips. Display foreign keys by the linked record's readable label. Use the existing ERP navigation for permitted links. Activating a link or other cell control must leave the row action idle.
- Route row clicks and the keyboard-accessible identity button through the original card's handler with its existing record ID and capability check. Reuse the existing modal and its CRUD, attachments, history and save flow. Keep view-only access consistent with the existing card.
- Wrap toolbar controls on narrow layouts, retain the Add placement and allow horizontal scrolling inside the table when columns cannot fit. Keep filters and column controls usable with touch and keyboard. Name the keyboard-focusable scroll region from the table caption. Keep sort icons decorative and expose the primary sort direction on its column header.

Migrate one section per phase. Review record ownership and links, compare visible records and existing permissions, then check modal identity, search, filter, sort, group, column preferences and the Sheet regression in Chromium. Verify preference reload, account isolation and use on another device for signed-in sessions. Record CI and stop for review before the next section.

Migrated Overview sections:

- Billing → Billing Summary, Buyer PO, Invoices, Packing Lists, Cartons, Dispatch / Transport and Returns. Buyer PO and invoice rows open their existing detail pages. Packing list and carton rows open their existing dialogs. Dispatch rows show the existing assigned cartons, while pickup remains a separate action. Returns and Summary are reports. Summary presents billing totals in a compact table and uses the shared grid for available stock. The four server-searched pages retain their existing search fields and paging. Sorting, grouping and column filters work within each loaded page. Linked invoice, packing list and transport references retain their permission checks and independent actions. Sheet keeps its existing controls and selected-record workflows.

- Finished Goods → Item stock summary, Sellable summary, Stock valuation, Items produced, Stock adjustments, Sellable products, Item prices and Price types. The two summaries retain exact-SKU server search and the existing page boundaries. On other paginated screens, table search and presentation controls apply to the current page. Products and prices open the existing contents dialog. The Sellable summary keeps its separate Costing history action, and Item costing remains a dedicated editor. Existing worksheets retain their selection and source inspection actions.

- Raw Material Inventory → Stock available, Movement history, Materials, Material suppliers, Material purchase orders, Stock receipts, Stock outward, Material categories, Units of measure and Outward types. Each page keeps separate Overview preferences. Orders use one row per document with line-item disclosure and totals by unit. Stock available and Movement history remain reports. Reconcile & close remains a separate permission-controlled action on positive balances, and reconciled outward rows cannot open for editing. Editable rows open the existing record editor. Related labels link to permitted pages, and Sheet stays on its existing worksheet projections and actions.
- Colours → Colour library, Colour mappings and Lab dips. Library and mapping rows open the existing editors by record ID with edit permission. Mappings show readable Pantone and brand references and link permitted destinations. Lab dips show Colour, Pantone, Edition, Latest version and Current status. Brand and Dyer are available in Columns. Each row opens the existing progress dialog by edition ID for viewers. Its existing permissions control version and edition actions. Library, mapping and edition grids keep separate Overview preferences, and their Sheet views keep the existing search, selection and editing workflows.

- Fabric → Yarn types, Fabric types and Suppliers. Tables show existing name and usage projections. The existing editors receive the yarn type ID, fabric type ID or composite supplier key. Supplier contact purpose links to Contact Categories when permitted.

- Fabric → Yarn purchase orders, Yarn bills, Knitting bills, Dyeing programs and Dyed fabric bills. One Overview row represents the existing document key. Overview search includes all document lines. Quantities sum the existing line values, and the line item disclosure works independently of the row editor. Related supplier, document and colour labels link only where the destination is permitted.
- Fabric → Dyed fabrics, Yarn left, Greige left and Batch traceability. These tables keep existing report row keys, numeric values and read-only access. Balance rows retain consumption by bill, and batch rows retain their yarn-to-receipt journey with authorized source links. The Fabric overview landing dashboard retains its navigation and metrics.
- Production → Job statuses (`productionStatuses`). The single Status field uses `item_status_list.status` and the original record editor keyed by `item_status_list.id`. The table has no outgoing foreign keys.
- Production → Stage types, Part names, Sizes, Product types, Variants, Flags, Gender, Brands, Stages, Job workers and Items. Each page has a distinct Overview preference key and opens its existing editor by the worksheet's document ID with edit permission. Reference tables lead with the record name. Items leads with Style code and shows Brand, Product type, Season and Batch number. Foreign-key cells use the existing projected labels and link only when the related page is permitted. The hidden Item parts and Item sizes preview routes retain their existing rendering. Task Board, Update Tasks and Job History retain their dedicated views.
- Production → Challans and Worker bills. Each document table opens the existing dialog by its document key. The overview search includes the existing job-line descriptions or bill assignments. Linked workers, issuers and challans navigate to the authorized ERP pages.
- Employee / HR → Employees (`overview-employees`). Employee code opens the existing Employee profile using `employee.id`. The contact name and existing photo appear beside the code. The contact name links to Contacts when the viewer has access, and the verifier is shown using the readable name from the Employee snapshot. The existing Current, Active, Inactive and Archived scope applies before grid filters. Employee view permission allows opening the profile, and the editor applies its existing create, edit and archive rules. The directory cards and their styles were removed. The Employee worksheet retains its existing controls.

- Employee / HR → Blood groups, Employment types and Gender. Each reference page uses its own Overview grid preferences and displays Name and Updated at. The Overview identity button and the Sheet selection action open the same reference editor by stable record ID with Employee edit permission. Employee create permission controls Add. The dialog follows the shared Review and Confirm Save workflow and uses the existing reference service.

During each migration, replace the card render path with the shared table and remove handlers, styles, helpers and imports used exclusively by those cards. Check references in other modules, worksheets, editors and browser acceptance tests before removing code. Keep the original modal and service boundaries.

### Mandatory Sheet-view contract

Use Suppliers and Colours as the reference for selection and the transition from a worksheet to an existing record form. The Sheet contract applies to record worksheets. Overview views retain their own interactions. Dedicated editors such as Item Costing follow their form contract, including draft and finalized states.

| Area | Required Sheet behavior |
| --- | --- |
| Search and actions | Use labelled, debounced search without a submit button. Place permitted Add and selected-record actions beside search. Keep controls visible with zero matches. Use the shared toolbar layout and wrap controls within the content width. |
| Selection and identity | A single data row supplies the stable record key from the currently displayed sort and filter order. Headers, blank rows and multi-row selections cannot activate a record action. Clear or revalidate selection when the records, sort, view or query change. Keep actions usable if an identifying column is hidden. |
| Add, Open and Edit | Add opens the existing create form. Edit opens the existing edit form for that exact eligible record. Open or View source shows the selected record or authorized underlying records. Calculated summaries and posted records offer inspection only. A create-only route cannot reuse its create form as Edit. |
| Forms and access | Enforce view, create, edit, format, export and print independently using the existing permission checks and backend authorization. Preserve the form's validation, save, cancel and return behavior. A failed save keeps the form available for correction. |
| Worksheet and preferences | Keep sorting, Columns, Zoom, formatting, export and print in the shared worksheet. Save supported presentation settings per authenticated account and worksheet. Protect worksheet values, including calculations, from direct entry, paste, cut, fill and drag. Formatting changes presentation only. |
| Regression checks | Exercise the real worksheet with populated and empty fixtures. Verify the record opened after sorting or filtering, permitted and denied actions, protected values and preference restoration. Check toolbar fit at desktop, tablet and phone widths. For shared changes, compare Overview visuals and exercise its existing interactions. |

## Colours browser verification

Chromium measurements at 1440, 1024 and 390 CSS pixels confirm the shared shell padding of `34px 38px`, `25px` and `20px 15px`, respectively. The Lab dips title stays `29px / 600` with `-0.6px` tracking at all three widths. Its eyebrow is `10px / 600` with `1.3px` tracking and `14px` bottom margin. The header gap is `10px` in Overview and `20px` in Sheet. The bottom margin stays `27px`.

| Component | Computed in Colours |
| --- | --- |
| View selector | `#e7eff7` background, `9px` radius, `4px` inset. Selected button is white with `8px 16px` padding, `8px` radius and `12px` text. |
| Lab Overview | The shared record table shows a five-column default with the same labelled, keyboard-focusable scroll region at all three widths. The Create edition action is below the view selector. |
| Lab progress dialog | `15px` radius with `28px` inset at 1440 and 1024 and `20px` at 390. The identity button opens the original progress dialog. Escape dismisses it. |

The Colours visual check compares the record table before and after switching to Sheet at each width. Worksheet tests cover existing selection, actions and zoom separately. [Colours visual checks](../fabric-poc/e2e/colours-visual.spec.js) · [Worksheet checks](../fabric-poc/e2e/worksheet-actions.spec.js)

## Automated drift checks

Run `npm --prefix fabric-poc run build` and `npm --prefix fabric-poc run e2e` for changes to shared UI. The Colours tests pin computed layout and styling at desktop, tablet and phone widths, then compare screenshots before and after the Overview → Sheet → Overview interaction. Finished Goods compares its view toggle against Colours in the same Chromium session. The tests capture both sides in the same environment so platform font rasterization does not require separate screenshot baselines. Spreadsheet values and editing rules are verified by functional tests. [Colours visual checks](../fabric-poc/e2e/colours-visual.spec.js) · [Finished Goods checks](../fabric-poc/e2e/finished-goods-live.spec.js)

## Challan audit

Challans and Worker Bills are sibling pages under Production. The workspace uses the established shell, shared Overview tables, FabricSheet, form groups, tables and dialogs. The worker bill editor selects the challan line it bills against. [Production documents](../fabric-poc/production-challan.html)
