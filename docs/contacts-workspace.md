# Contacts entry

Approved structure: Contact → Contact items → Bank accounts → Extra data. The last three collections are optional and may contain zero rows. New/Edit Contact uses one grouped form and review; the existing individual pages remain available. The stable `contactPeople` route/resource key is retained for compatibility, with the displayed name Contact items.

Verified against live schema: item name/address/phone and bank business fields (including supporting document) are nullable. An extra-data row requires its key, but its value is nullable. Every stored child requires contact_id. Optional collection means no child row, not a nullable parent link. No schema relaxation is needed.

Contact owns its contact_items, contact_bank_account and contact_extra children, joined through contact_id. The combined form delegates permissions to the existing individual resources. A caller without bank permission cannot view or change that section. Existing rows retain IDs and attachment references; the form does not hard-delete existing child records. Completely blank new rows are ignored. Changes are validated before the one local workspace save, so a failed section does not persist a partial contact.

This combined editor currently uses the local-preview adapter, as the existing Contacts module does. It does not claim a live database transaction. The coherence contract explicitly marks that limit; connecting it to production requires a separately reviewed database command and CI/CD release. The supporting-document selector references existing attachment records; no new Storage upload route or bucket has been invented in this change.

## Primary selections

The approved addition is `contact_items.primary_address`, `contact_items.primary_phone` and `contact_bank_account.primary_bank_account` (not `primary_back_account`). Each is boolean, NOT NULL, default false. Existing records remain non-primary. Each flag has a separate partial unique index on contact_id: at most one primary of each kind, but none is valid, and address/phone may use different item rows. The rule is enforced under concurrent writes, not just in the UI. No ownership, FK, grant or RLS changes are made.

In the combined form, checking a primary clears that flag on other rows of the same section. Unchecking permits no primary. Standalone pages display and edit the same flags; conflicting independent edits are rejected rather than silently overwriting another record. Swaps in the combined form are validated and applied to a private copy before the single workspace save. A future live command must lock the parent, clear the displaced primary before setting its replacement, check child permissions and save the whole operation transactionally.

Migration: `20261031201306_contact_primary_selections.sql`, tested only in the isolated database. Production release must use the reviewed GitHub main deployment path. The captured live schema is not rewritten to pretend this is deployed: `scripts/contact-primary-contract.mjs` combines the capture with only the reviewed migration-backed columns for release coherence checks. Its contract also checks that all three database uniqueness indexes are present.
