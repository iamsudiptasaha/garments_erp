# Fabric spreadsheet POC — Univer

The handwritten grid was replaced with **Univer 1.2.0**. Spreadsheet rendering, selection, formatting, colour palettes, clipboard, undo/redo, formulas, sorting, filtering, row/column dimensions and freeze panes come from native Univer packages, not a recreated Excel toolbar.

## Run

- `npm ci`
- `npm run build`
- `npm start` serves the built `dist/` at http://127.0.0.1:8765
- `npm run dev` provides Vite hot reload at http://127.0.0.1:8766
- `npm test`

## Modules

- `src/model.js`: business sample records and validations.
- `src/workbook.js`: converts source records to a native workbook; formulas link knitting, dyeing, yarn and greige balances.
- `src/app.js`: the app shell, library setup, local storage, local permissions and source-value validation.

All data stays in this browser. No Supabase connection or production writes. Native snapshots persist formatting, widths, frozen rows/columns, workbook data and formulas under `fabric-univer-v1`. Old sample model values are loaded once if available; old handwritten-grid highlights do not transfer.

## Native UI

Start: font family/size, bold/italic/underline, fill colour and font colour, borders, alignment, wrapping, number formats.
View: freeze rows, columns or to the active cell; zoom and gridlines.
Data: sorting and filters. Use the library's selection statistics at the bottom. Use the native name box to select a range such as F2:F4.

Identities and derived columns are natively protected. Balance sheets use native worksheet permissions to protect values while allowing styling. On source sheets, protected identity and derived ranges also block styling; some full-range sorts may be blocked by these protected ranges. Protection is library UI behaviour; production still requires server enforcement. User access is a local demonstration.

Native formulas update balances immediately. “Validate source values” checks raw source numeric values and business constraints. Validation is explicit, not a before-edit transaction gate. Invalid draft edits can exist until corrected with native Undo; do not connect this sandbox directly to production writes. Numeric-input formulas are rejected during source validation.

## Licensing and limits

Installed Univer packages use Apache-2.0; see `node_modules/@univerjs/*/LICENSE`. No Pro packages or license keys were added.

- Native print/PDF, Office-file exchange and real-time collaboration are Pro capabilities and are not enabled. The prior custom CSV/print toolbar was removed. Ctrl/Cmd+P in Sheet view explains the limitation rather than printing an incomplete canvas.
- Pro XLSX/CSV/TSV exchange requires a conversion backend; print is a client-side Pro plugin. No purchase is made.
- No VBA/macros or claim of full Excel compatibility.
- Browser-only snapshots are not multi-user audit history.
- Structural edits and new business records are not connected to the ERP. Source validation detects missing/duplicate IDs.
- Overview is an app view of native cell values, not a second spreadsheet implementation.

Official documentation: https://docs.univer.ai/guides/sheets/getting-started/installation
Print: https://docs.univer.ai/guides/sheets/features/print
Exchange: https://docs.univer.ai/guides/sheets/features/import-export

## FortuneSheet comparison
Open `/fortune.html` for FortuneSheet React 1.0.4 with native short formatting toolbar, hidden formula bar and hidden workbook tabs. Selection summary verified through the UI: F2:F4 gives count 3, sum 920, average 306.67. Formatting, resizing, freeze and sorting are native library features; this isolated trial does not save to Supabase or enforce ERP permissions. Existing model tests pass, but do not test FortuneSheet itself.

Dependency review: npm audit reports one moderate uuid advisory (GHSA-w5hq-g745-h8pq), propagated through FortuneSheet core and React (three reported entries). No automatic fix is available. Assess reachable code and upstream upgrade before production; do not force a major dependency override blindly. A native summary rendering quirk in this version suppresses zero-valued sum/average/min/max.

### Protected record trial (current)
`/fortune.html` now supplies Add/Edit record dialogs, validation against sample linked stock, whole-record sorting, native formatting and browser-local persistence keyed by record ID + field. Context menus retain copy and sizing, with no paste or raw range sort. Input capture blocks direct value editing, paste/cut/delete/autofill shortcuts; native hooks and authoritative projection reconciliation reject value/structure mutations that reach the library. These frontend guards are not server authorization.

CSV export follows the current record order and quotes/neutralizes formula-like text. Print/PDF uses the native formatted HTML range export, with a small report adapter restoring cell backgrounds omitted by the native exporter, fitting columns to the page and repeating the header. The browser print dialog handles printers/PDF. CSV does not preserve formatting. Formatting and records survive refresh in this browser, not authenticated cross-device sessions. Data-moving drag handles and add-blank-row affordances are hidden.

Verified in the browser: protected double-click/typing, paste, cut and delete; only-copy context menu; native bold and fill; formatting follows whole-row sorting and refresh; invalid consumption rejected; valid edit saved; new row added and persisted; CSV file downloaded in record order; flat formatted print preview. A drag-autofill attempt was rejected and restored from authoritative records; its handle is now hidden. Unit tests cover record sorting, style identity, mutation detection, validation and CSV quoting.

Verification limit: the print button invokes the browser's native print flow, which blocks in-app browser automation; final physical/PDF output was not verified. Native Copy generates the correct selected-range HTML, but clipboard-read tooling returned its previous test text, so system clipboard delivery is not asserted as verified. Both are browser integration checks to repeat in the target deployed browser.

## Quality gate
Run `npm run quality` for lint, unused-code/dependency detection, duplicate-block detection, tests and build. See [quality policy](../docs/code-quality.md) for thresholds, CI and known dependency findings.
