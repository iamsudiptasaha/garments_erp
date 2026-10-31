# Shared modules completion

Priority agreed: complete Files/buckets and Administration before further business modules. No production changes are authorised by this checklist.

## Inspection findings — 31 October 2026

Read-only database inspection confirms protected RPCs exist for bucket registry, upload routes, upload reservation/finalisation, reads, cleanup, bucket lifecycle, roles, archive and employee account linking. The frontend calls these live services. Older introductory documentation still describes preview-only behaviour and must not be used as the current capability list.

Existing Files UI supports private bucket creation/removal, route destination selection, per-route MIME/size limits, saved-record selection, upload/read and interrupted-upload cleanup. Removal is intentionally restricted to unused empty buckets. Existing attachments retain their original location after a route changes.

Existing Administration UI supports roles, screen permissions, searchable role membership, account linking/enabling, archiving unassigned roles and activity review. Employee profiles belong to HR. Account linking selects an existing Auth identity; it does not provision a new identity. Login recovery explicitly remains unavailable. The separate initial-admin function is not a general employee provisioning workflow.

## Completion sequence and acceptance

1. Files/buckets: reconcile every supported attachment FK with its registered route and group, check metadata/limits and admin visibility, then exercise upload → finalisation → open/download and interrupted failure recovery using isolated fixtures. Verify paused routes preserve reads and forbidden actors cannot write. Identify unsupported attachment slots before expanding routing. Do not implement file deletion/replacement without first agreeing record/history semantics.
2. Account lifecycle: employee-first selection, provision or link login, assign role, enable/disable, password setup/change and recovery. Keep credentials out of business tables/browser storage/logs. Provisioning and administrative password reset require a guarded server operation and explicit implementation review; never expose service credentials to the browser.
3. Permissions and audit: current-user server checks, last-administrator protection, no assignment to archived roles, stale-write/concurrent-change checks, and useful searchable audit entries. UI visibility is not the security boundary.
4. Shared integration: reusable saved-record attachment controls and permission guards. Connect other modules through these shared services rather than duplicating storage/auth logic.

For each step, distinguish source inspection, isolated tests and authenticated live verification. Do not describe unexercised end-to-end flows as complete. Present any database/API changes for confirmation before applying them; preserve platform-independent application code.
