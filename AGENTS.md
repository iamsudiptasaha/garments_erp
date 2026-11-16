# Deployment policy

- Every deployment must run through GitHub Actions, including the portal, mailer, backend functions and production database migrations.
- Never deploy from a local CLI, apply production SQL directly, or use dashboard deployment controls. User approval does not waive this rule.
- Never spoof CI environment variables, bypass failed checks, remove required gates, or override branch/environment protections to complete a release.
- If the relevant deployment workflow is missing or broken, repair and review it through Git first. Commit work to `dev`; a reviewed merge into `main` triggers the production workflow.
- Report deployment status from the actual GitHub run. A successful commit, merge or CI check alone does not prove deployment succeeded.

# Database and UI coherence

- The database is the source of truth. Before implementing a screen, inspect its columns, foreign keys, related record ownership, constraints, generators and relevant functions.
- A foreign-key input must select the linked record. Do not turn it into a second editor for that record's children without explicit user approval. Employee contact links do not authorise editing contact people or bank accounts inside Employee.
- Contact details, bank accounts and their supporting documents belong to Contacts. Employee screens link employee and emergency contacts through the existing foreign keys.
- If an approved UI conflicts with the database, stop the affected implementation, explain the exact conflict and consult the user before proceeding. Do not silently change either the database or the UI to reconcile it.
- Coherence checks must cover relationships and ownership, not only matching table and column names. Passing syntactic checks does not establish workflow correctness.
- Run `npm --prefix fabric-poc run check:coherence` for every UI/backend change. Vite validates startup, builds and source/backend changes automatically; the staged pre-commit hook and CI enforce the same checks. Extend the reviewed ownership contract before adding a new custom screen or save boundary. A new business interpretation requires user consultation, not merely a new allowlist.

# Mandatory frontend skill

- For every frontend or UI change, including ERP screens, mockups, shared components, styles, and client-side behavior, discover and read the installed **Modern Web Guidance** skill before planning or editing the affected UI. Look for `modern-web-guidance` in the active skill catalog and open its registered `SKILL.md`. If it is absent from the catalog, locate the active installation in the configured Codex skill roots or plugin cache. The Chrome plugin cache uses the directory pattern `googlechrome/modern-web-guidance/<version>/skills/modern-web-guidance/SKILL.md`. Resolve the installed version at runtime.
- Follow the actual installed instructions. For work covered by the skill's search workflow, search first, retrieve the applicable guides before implementing, and verify the change against them. If the installed instructions cannot be located or read, report the blocker before editing frontend files.
- Use Modern Web Guidance for web platform practices within the existing ERP design system. The canonical ERP design reference and the repository's UI contracts govern product design decisions. If guidance conflicts with a repository requirement, keep the repository requirement and report the conflict. Continue to follow the existing approval rules for themes, UI libraries, and styling conventions.

# UI design system

- Before adding or modifying any ERP UI screen or mockup, read and follow [the canonical ERP design reference](docs/design-system.md). Use Colours and the relevant established page as visual references. Reuse existing components and styles, preserve layout and density, and document exceptions. Get approval before introducing a theme, UI library or styling convention.
- For shared UI changes, run the relevant browser visual and interaction checks documented in the design reference. Preserve existing screenshots, computed styles and behavior unless a change is approved.
- Use the shared record-grid controls and preference store for configurable ERP grids. Use debounced, labelled search, interactive ascending and descending sort, content-fit widths with manual overrides, and stable grid and column keys. Persist presentation per authenticated account and verify reload, cross-device use, account isolation and responsive toolbar alignment.
- Apply the mandatory [Sheet-view contract](docs/design-system.md#mandatory-sheet-view-contract) to every worksheet. Test selection by stable record identity, eligible Add/Open/Edit workflows, read-only source inspection, empty states, independent permissions and protected values. Keep Sheet-specific changes scoped to Sheet and verify existing Overview interactions and visuals.

# Attachment acceptance

- Inventory attachment slots from the ERP Files registry and map each to its owning record and actual create and edit controls.
- Verify each slot in Chromium against disposable local Supabase with authenticated users. Exercise file selection before review, confirmation, upload, opening or downloading the exact saved bytes, replacement and removal. Use both new and existing records. Check the database reference, private Storage and allowed and denied access.
- Record PASS, FAIL, NOT IMPLEMENTED or NOT TESTED separately for each operation and record state. A registered route, direct API call, mocked browser or existing file download cannot establish that uploading through the editor works. An attachment workflow is complete only when every applicable operation passes.
