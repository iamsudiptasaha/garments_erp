# Employee photo and Lab Dip follow-up

Prepared for review; not applied to production by this work.

The revised ER has one `employee.employee_photo` attachment FK. Migration `20261105152128_employee_photo_attachment_and_checklist.sql` converts that field to bigint with `ON DELETE SET NULL`, removes only `production_checklist.tna_acquired_status_id`, and retains Techpack and Ordersheet. The production release script includes the new migration and verifies these postconditions.

Existing photo strings are matched against attachment ID, storage path or address. Only a single matching image in the employee bucket is retained; ambiguous, missing or other-bucket references become NULL. No attachment objects are deleted. Populated replay fixtures cover preservation by ID/address, unresolved links, other-bucket links, FK rejection and attachment deletion.

Employee profile saves no longer accept photo text or attachment IDs. The existing Documents tab exposes an image-only `employeePhoto` route through the guarded private file service. This is a compatibility change, not an Employee page redesign. Contacts ownership and access permissions remain unchanged. Employee status is changed in a Status tab after Documents, with read-only operator verification and review/confirmation. Directory cards show status without activation actions. Profile edits preserve inactivity; status writes use the existing revision-checked `erp_set_employee_active` command.

Lab Dip reads date, comments and status from the latest `lab_dip_version_item`. A review-only edit calls `erp_add_lab_dip_review` with the expected current review ID; conflicts are shown without a fallback write. New versions and mixed version/review edits use one existing document transaction, whose compatibility envelope is translated to child review writes by the server. No review columns are recreated on the physical version table. The form labels distinguish review date/comments; review history remains visible.

`garments_access` contains the role/resource/user tables, including `app_role_resource_permission` for role permissions and `app_resource_table` for table mappings. These are distinct structures; no access-schema changes are part of this release. Stock-view naming is deferred to Billing as requested.

Release through the existing reviewed dev → main path and `.github/workflows/database-release.yml`. Do not apply SQL locally against production. The new photo route requires the database migration before it is usable by the hosted UI. This work does not dispatch a deployment or migration workflow.

Validation: frontend quality/coherence, browser tests with the CI fixture Supabase endpoint, isolated SQL/security/concurrency checks, populated production/photo migration replay, and synthetic backup restore. Review the current execution results before claiming a production release.
