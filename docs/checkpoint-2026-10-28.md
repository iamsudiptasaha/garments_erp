# Checkpoint — 28 October 2026

## Current state

Fabric, Colours, Inventory, Miscellaneous and the first Production screens are implemented as local sample-data workspaces. The protected sheet and Overview remain the two views. Business data is not yet connected for shared live persistence.

Live Supabase account management is available at access.html: roles, employee assignments, guarded role archiving, account access and activity log. The signed-in navigation now links into fabric.html?live=1 using the authenticated permission snapshot. The sidebar was rebuilt and verified after login, including collapse/reopen; action buttons and inputs were resized.

Applied database SQL and screen/table mappings are recorded under database/applied and database/catalogue. Draft SQL is explicitly separate and must not be assumed applied. Local environment files remain ignored.

## Resume here

1. Complete combined item creation: details, item parts, designs and item sizes in one flow, with a visual relationship review and section-level editing before saving. The existing basic item form is incomplete. Confirm whether designs belong to an item part or the whole item; the current schema links designs through jobs. Do not invent that relationship or manufacture jobs to store it.
2. File storage foundation and isolated upload/admin previews exist. The five proposed private buckets are NOT provisioned; server upload/finalisation/download commands and form integration remain pending. garments_erp.bucket_group is the canonical registry. See docs/file-storage.md and the unapplied private-file-storage.sql draft.
3. Continue live business-data integration and database permission enforcement before calling the business workspace production-ready. UI visibility alone is not database authorization.
4. Production challans, floor entry validation/camera scanning and TNA remain pending. See docs/production.md.
5. Phone/password login is the current no-SMS-cost direction. The initial Administrator currently signs in through the existing email account; recovery delivery and phone-account setup still need completion. Do not request passwords in chat.

## Verification

Latest application quality run passed lint, unused-code checks, duplication checks, 77 tests and production build. Sidebar appearance and collapse/reopen were verified in the signed-in browser. Bucket status was checked read-only: proposed buckets were not present. No live file upload was claimed or tested.
