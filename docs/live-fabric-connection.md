# Live Fabric and Colours connection — deployed

The prepared connection replaces local business records only when `?live=1` is used after sign-in. Preview mode remains local. The local preview build has been updated.

## Database change to approve

`supabase/migrations/20261029194657_connect_live_fabric_colours.sql` adds:

- `erp_fabric_snapshot`: permission-scoped Fabric/Colours/reference reads using the existing screen-to-table catalogue. Company lookup exposes company name and ID; no GST, bank or employee records. Attachment lookup exposes referenced filenames and metadata, never private storage paths.
- `erp_save_fabric_document`: atomic document saves through a closed, version-controlled field contract. Existing role permissions are checked by `has_screen_permission` on every call.
- Private helper functions for the closed contract, bigint-safe JSON and document ownership validation.

These functions use SECURITY DEFINER for access to the private business tables and grant execution to authenticated sessions. Their own guards are therefore the security boundary. No direct table grants, RLS disabling, role assignment, existing data migration or data deletion are performed by deploying the migration. Within an authorized document edit, removed child lines can be deleted; document headers cannot be deleted through this endpoint.

The user explicitly approved this migration on 30 October 2026; it was applied successfully using Supabase migrations. No alternate deployment path was used.

## Save behaviour

- Header, detail lines and output batch mappings save together; temporary browser IDs are resolved to database-generated IDs in one transaction.
- Database-generated program and yarn PO numbers remain server-owned.
- Bigint identifiers travel as strings, without browser precision loss.
- Original row contents and root timestamp are checked under locks to reject stale edits. Portal writes serialize before checking yarn/greige balances; root timestamps advance after every document save.
- Caller-supplied fields, tables, cross-document moves, arbitrary attachment links and header deletion are rejected. Uploads continue through the existing file endpoints.
- A failed network/database save keeps the editor open and shows the error; nothing falls back to local business storage.
- Missing historical values remain missing. No sample rows, approvals, quantities or identifiers are synthesized for live records.
- Shared formatting persistence and live Production/Inventory/HR integration are separate work; these are not enabled by this change.

## Validation

The migration executed successfully in PostgreSQL. Anonymous read/write denial was verified with SQL, without setting or forging an Auth identity. The normal signed-in browser session loaded actual lab dips, dyeing programs, greige balance and batch traceability. Client contract, diff, identity precision, network failure and empty-state tests pass; existing domain tests and offline coherence checks pass. No business records were inserted or edited during verification. Positive live-write, viewer denial, stale-edit and transaction rollback tests remain unverified against the deployed endpoint. Automatic review rejected SQL identity simulation and a separate authenticated rollback-test RPC; neither approach was used.

Supabase security advisors were checked after deployment. No findings mention the new Fabric helper functions. Existing project-wide findings (including unrelated exposed relations/functions) remain outside this connection change; this check is not a full production security sign-off.
