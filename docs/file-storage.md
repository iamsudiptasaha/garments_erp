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
