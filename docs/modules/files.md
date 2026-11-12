# Files

**Live private Storage service and bucket administration.** Saved business records expose supported attachment slots through the file workspace. Bucket group and route configuration live in Administration. The ERP registry and slot foreign keys define ownership. Supabase Storage holds bytes, while `attachments` holds application metadata.

## Upload and download

`/files.html` searches saved records using registered attachment slots. The Edge Function authorizes the session and target through guarded SQL, reserves a unique path, validates size/MIME and PDF/image signatures, then uploads with overwrites disabled. Confirm save starts staging with a request ID tied to the file hash and the reviewed prior attachment. Retries reuse the reservation. Finalization locks the target and checks the prior attachment identity before writing metadata and the parent FK atomically. Replacement and removal retain the old object for audit and retention. The current link controls scoped preview and download. Signed read links expire after 60 seconds. Signature checks do not scan for malware.

An interrupted upload can be retried for 15 minutes. The administrator's **Clean up interrupted uploads** action removes expired objects and catches late objects from cancelled uploads. No background cleanup schedule is configured. Cleanup uses the Storage API and excludes ready attachments. Use real saved IDs for business form integration.

## Configurable routes

`garments_erp.app_file_route` now holds the destination `bucket_group_id`, allowed MIME types, per-file limit, enabled flag and version for each registered attachment integration. The immutable integration definition fixes its source table/attachment column and permission resource; an administrator cannot turn a route into arbitrary SQL/table access. The admin page lists all registered routes with exact table and column, resolved bucket group/bucket and file rules, and saves route changes through a guarded RPC with audit and optimistic locking.

The shade-card integration is `lab_dip_version.shade_card_image_attachment`, initially routed to `items` with JPEG/PNG/WebP only. Existing terminal-edition immutability still applies. Bill/document integrations allow PDF/images; images cannot be configured as PDF. All limits must fit the destination bucket limit, with a service cap of 10 MiB. Lowering a bucket limit also lowers the effective upload limit. The service reads the route at upload reservation time; the live client reads the same route for its picker and validation. Configuration is not taken from a browser-only static table.

Reassigning a route affects only new uploads: each saved attachment retains its own bucket_group_id/path. Route edits are refused while an unexpired upload is pending. Pausing a route stops new uploads but retains record/file reads. Bucket-group-to-bucket rotation remains locked to preserve existing file locations. The route editor includes the five new document routes. Buyer PO, return bills, transport bills and transport dockets use the existing Fabric Bills group. Contact bank documents use the existing private Employee Documents group, with Contact Bank Accounts permissions. Bucket creation is a separate Administration operation.

## Bucket lifecycle

Administrators can now create a private bucket and matching bucket_group in one database transaction, choosing the group key, description, allowed PDF/image types and 1/2/5/10 MiB per-file cap. The server generates a unique bucket address. New groups have no assigned routes until an administrator selects them on the Upload routes page. Duplicate/unsafe group keys and unsupported types/limits are rejected.

Removal is a separate, typed-confirmation flow. A guarded database command locks the group and rejects assigned routes, attachment references, any upload-ledger references (including retained upload history), or Storage objects. It reserves the operation; uploads and new route assignments are fenced off. The Edge Function uses Storage `deleteBucket` (never `emptyBucket`) and finalises the registry removal only once the Storage bucket is gone. Failed removal can be cancelled/retried; after a Storage deletion followed by a finalisation failure, the registry exposes a Retry removal state so the operation remains recoverable. Audit events remain after removal. No existing bucket or file was removed for testing.

Buyer PO and Returns link to the exact saved record. Dispatch links to docket search and the transport-bill list. Bank documents are available from Files for saved live bank accounts. Confirm the business record first when an attachment needs its saved ID, then review and confirm the attachment separately.

Sources: [Files UI](../../fabric-poc/src/files), [file service](../../supabase/functions/erp-files), [route SQL](../../database/applied/20261029184152_configure_attachment_upload_routes.sql).
