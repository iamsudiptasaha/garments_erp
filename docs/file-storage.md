# File storage foundation

## Registry is the source of truth

The feature-sheet groups are retained exactly:

| Registry group | Proposed private bucket | Intended files |
| --- | --- | --- |
| job_worker_bills | garments-job-worker-bills | Job worker bills |
| fabric_bills | garments-fabric-bills | Yarn, knitting and dyed-fabric bills |
| items | garments-items | Item files excluding job worker bills |
| raw_material_bills | garments-raw-material-bills | Raw material receipt bills |
| employee | garments-employee | Employee supporting documents |

Use **garments_erp.bucket_group** as the canonical registry (renamed by the parent task from bucket_group_id). Its `bucket_id` already references `storage.buckets.id`, its group key is unique, and its bigint ID is identity-generated. `attachments.bucket_group_id` keeps its existing name and references that registry ID; do not introduce another bucket registry. The adapter resolves group → registry row → bucket ID, so a future bucket rotation does not require hardcoding addresses into forms.

Read-only audit found the registry and attachments empty. Existing buckets report-templates, public, personal and uploads are unrelated and are neither reused nor changed. The SQL in `database/drafts/private-file-storage.sql` is **unapplied** review material, not a migration already tested/executed on the server. It proposes provisioning these five private buckets, preserving existing group IDs/mappings, refusing public bucket reuse, checking unique group/path entries and introducing a private staged-upload ledger. It intentionally grants no browser access and installs no broad Storage policy.

## Local review and reusable component

Open `/files.html` after building the app. The independent preview uses sample registry records and **IndexedDB** to store file blobs and metadata locally. Nothing is uploaded to Supabase, shared between people or linked to live bill/employee records. Browser storage clear removes these local files. The preview supports choosing the registered group, choosing an allowed attachment field, adding PDF/images, listing per-document files and downloading them. Files are retained as separate entries; no overwrite/delete UI exists.

`src/files/panel.js` exports `FilePanel` for embedding in an existing saved-record form:

```
<FilePanel
  store={fileStore}
  registry={bucketRegistry}
  targetKey="knittingBill"
  recordId={savedBill.id}
  recordLabel={savedBill.invoice_number}
  canRead={permissions.view}
  canWrite={permissions.edit}
  onAttached={refreshSavedRecord}
/>
```

Use real server permissions; component flags are UI affordances, not security. Require a saved record before attachments. Do not make the record ID editable in the attachment panel. `onAttached` is a refresh notification, not the operation that links the live file: the server finalisation command owns the FK transaction.

Known existing FK targets are configured in `src/files/model.js`: yarn_bill.bill_attachment, knitting_bill.bill_attachment, dyed_fabric_bill.bill_attachment, job_worker_bill.bill_attachment, item.image_attachment, raw_material_check_in.bill_attachment, employee.supporting_document_1_upload and supporting_document_2_upload. The worker-bill resource is a future screen and must remain denied until registered. Other existing attachment FKs (bank documents, transport, returns and buyer POs) remain untouched because their bucket-group/access mapping needs explicit review. `employee_photo` is text, so it is not silently treated as an attachment FK.

## Live adapter contract, not active endpoints

`createLiveFileStore` requires injected `beginUpload`, `finaliseUpload`, `cancelUpload`, `listAttachments`, `readAttachment` commands. These are server contracts; this work does not pretend those endpoints have been implemented or activated. The browser cannot choose a bucket or arbitrary object path. It accepts only a ticket matching the registered group and exact record/field path, calls Supabase `uploadToSignedUrl` with `upsert:false`, and finalises afterward. The server must also enforce those invariants. Download/open requests go through fresh record-authorisation checks to obtain a short-lived signed URL. Public/signed URLs are never persisted in attachment metadata. No service/secret key is used in the client.

The server must validate actual content signatures (browser MIME is only a convenience check), size, closed target/slot allowlist, parent existence, active employee, role/resource rights and expected current parent attachment before issuing tickets. Preliminary limits are PDF/JPEG/PNG/WebP, item images only JPEG/PNG/WebP, 10 MiB per file; these are proposed defaults to review, not a Supabase plan limit.

## Upload lifecycle and failure handling

1. **Reserve:** a guarded server command checks access and resolves the live registry/private bucket, allocates random object key and single-finalisation reservation and signed upload ticket. Original names are display metadata only.
2. **Upload:** use a signed upload token to the one generated key, never upsert.
3. **Finalise:** recheck permission/object metadata; lock the reservation and parent record; compare its previous attachment; insert metadata and update the scalar attachment FK atomically. Return the same result on a retried finalisation. Preserve replaced attachment/history.
4. **Read:** recheck record visibility every time before streaming or generating a short-lived URL. Employee/bank files must never become accessible just through general Contacts lookup permissions.
5. **Failure:** a failed upload/finalisation invokes trusted cancellation. If cancellation fails, the client explicitly reports cleanup pending. A durable expiry/cleanup worker must remove unreferenced staged objects through the Storage API and then mark cancellation complete. Never delete storage.objects rows directly. Supabase signed upload tokens remain usable for 2 hours; a shorter 15-minute finalisation deadline does not revoke them. Track upload_token_expires_at separately. Cancellation remains cleanup_required and is reconciled until the token expiry plus clock-skew grace; only then mark cancelled after confirmed object removal. This prevents a late token replay recreating an orphan after an early deletion.

The DB transaction and Storage upload are separate services; no client implementation can promise cross-service atomicity. The SQL ledger is a foundation for durable cleanup, not a completed worker. No hard file-delete/retention policy is activated until reference sharing and recovery requirements are agreed.

## Verification

Unit tests cover the five exact groups, registry bucket rotation, private/missing/duplicate-group checks, MIME/size/record-path validation, bigint IDs preserved as strings, local repository persistence/document scope, successful ticket flow, upload/finalisation failures and cancellation, and wrong bucket/target rejection before Storage is touched. Live policy tests and real uploads remain pending. Browser review verifies only the local component.

Sources checked: [Storage bucket access model](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Signed upload](https://supabase.com/docs/reference/javascript/storage-from-uploadtosignedurl).

## Bucket editing belongs to Administration

`BucketSettings` is a separate component in `src/files/settings.js`; business `FilePanel` has no configuration controls. `/files-admin.html` is an explicitly labelled, isolated Administrator-design preview, simulating an admin over example registry data only. It can review description, upload limit and private-bucket selection; it cannot create/publicise real buckets or persist live configuration. The reusable component rejects non-admin rendering, and its local controller rejects non-admin commands, stale versions, public/unknown destinations, buckets belonging to other groups and redirection of any group with attachments. Local settings changes are intentionally session-only; the main `/files.html` sample registry is independent.

The draft also proposes a private `update_bucket_settings` command using the existing `require_administrator()` guard, row/version checks, private destination checks, group uniqueness, reference/in-progress-upload checks, version increment and server audit. It is revoked from browser roles until a reviewed API wrapper is activated. A stable group with existing attachments or staged uploads cannot simply be redirected: attachments currently store group ID + path, not their original bucket snapshot. A versioned rotation/migration design must preserve old locations before that restriction can be relaxed. Group keys are fixed feature-sheet definitions, not editable labels. Bucket creation is likewise an admin-only provisioning operation and remains an unapplied draft.

## Activated 30 October 2026 — supersedes the preview-only sections above

Migration `20261029183050_activate_private_file_storage_and_bucket_registry` provisions all five private buckets and registry rows. `/files-admin.html` now requires a real enabled Administrator login and edits live descriptions/size limits with version checks. Group keys and bucket destinations are locked. `/files.html` searches actual saved Supabase records and attaches files using their registered field, never a local sample ID.

The deployed `erp-files` Edge Function authenticates the session, checks file signatures for PDF/JPEG/PNG/WebP, reserves through guarded SQL commands, uploads server-side with `upsert:false`, then finalises metadata and the parent attachment FK in a transaction. The service credential exists only in the Edge runtime. Public RPC wrappers are invokers; private guarded commands check active account, employee, screen permission and parent existence. No broad Storage policy or public file access was added. Existing unrelated buckets are unchanged.

This activation deliberately uses a server-mediated upload instead of the earlier proposed signed-upload ticket adapter. There is no reusable browser upload token to revoke. Replacement uses a new object, retains old attachments and checks the previous parent FK. Authorised reads issue a 60-second signed link; a link already issued may remain usable until expiry. Signature checks are not malware scanning. File size is capped at 10 MiB or the lower group setting.

Failed uploads attempt cleanup. If the runtime is interrupted, the ledger persists the reservation; an Administrator can use **Clean up interrupted uploads**. No automatic background cleanup schedule is configured. The service removes objects using the Storage API; it never deletes `storage.objects` rows directly. Ready attachments cannot be removed by this cleanup action.

Verified: five private live registry groups; Administrator registry/record listing; unknown/missing parent rejection; non-admin and anonymous access rejection; stale-settings conflict; no direct browser ledger writes; public RPCs remain invokers. Local lint/unused/duplication checks and 88 tests/build pass. Browser verification reached the real sign-in gate; the browser session was signed out, so an authenticated end-to-end upload/download still needs a user session. No passwords or real bill attachments were changed for testing.

The business forms still use sample records. Embed FilePanel in those forms only after each form is connected to actual database saves. Colour shade-card attachment slots are not yet in the closed attachment target list and must be mapped during the Fabric/Colours alignment pass.

## Configurable routes — 30 October 2026

`garments_access.app_file_route` now holds the destination `bucket_group_id`, allowed MIME types, per-file limit, enabled flag and version for each registered attachment integration. The immutable integration definition fixes its source table/attachment column and permission resource; an administrator cannot turn a route into arbitrary SQL/table access. The admin page lists all nine routes with exact table and column, resolved bucket group/bucket and file rules, and saves route changes through a guarded RPC with audit and optimistic locking.

The ninth integration is `lab_dip_version.shade_card_image_attachment`, initially routed to `items` with JPEG/PNG/WebP only. Existing terminal-edition immutability still applies. Bill/document integrations allow PDF/images; images cannot be configured as PDF. All limits must fit the destination bucket limit, with a service cap of 10 MiB. Lowering a bucket limit also lowers the effective upload limit. The service reads the route at upload reservation time; the live client reads the same route for its picker and validation. Configuration is not taken from a browser-only static table.

Reassigning a route affects only new uploads: each saved attachment retains its own bucket_group_id/path. Route edits are refused while an unexpired upload is pending. Pausing a route stops new uploads but retains record/file reads. Bucket-group-to-bucket rotation remains locked to preserve existing file locations. Creation of arbitrary integration definitions or additional buckets is not exposed by this page; the five groups and nine supported source fields are registered and seeded.

Rollback-only live DB tests verify destination routing, MIME/size rejection, paused uploads with retained reads, in-flight locks, stale-version rejection, image-only slots, non-admin denial and no direct browser route writes. 89 application tests pass, plus the coherence checker tests. Browser verification shows the real signed-in route list/editor. The offline coherence gate still intentionally reports the two pre-existing business-form mismatches documented in the Fabric audit.

## Bucket creation and removal — 30 October 2026

Administrators can now create a private bucket and matching bucket_group in one database transaction, choosing the group key, description, allowed PDF/image types and 1/2/5/10 MiB per-file cap. The server generates a unique bucket address. New groups have no assigned routes until an administrator selects them on the Upload routes page. Duplicate/unsafe group keys and unsupported types/limits are rejected.

Removal is a separate, typed-confirmation flow. A guarded database command locks the group and rejects assigned routes, attachment references, any upload-ledger references (including retained upload history), or Storage objects. It reserves the operation; uploads and new route assignments are fenced off. The Edge Function uses Storage `deleteBucket` (never `emptyBucket`) and finalises the registry removal only once the Storage bucket is gone. Failed removal can be cancelled/retried; after a Storage deletion followed by a finalisation failure, the registry exposes a Retry removal state so the operation remains recoverable. Audit events remain after removal. No existing bucket or file was removed for testing.

Verified using rollback-only live database tests: private creation and MIME/size metadata, duplicate/key validation, exact typed confirmation, assignment/removal interlock, refusal to finalise before Storage deletion, cancellation, assigned-route rejection and non-admin/anonymous denial. The test bucket was rolled back. Browser proof verifies the signed-in create form and disabled removal for assigned buckets; no real permanent delete was performed by the agent. All 90 application tests pass; lint/unused/duplication/build checks also pass. The pre-existing coherence mismatches remain separately blocked.
