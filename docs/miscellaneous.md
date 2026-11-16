# Miscellaneous screens

The workflow's Miscellaneous section describes a shared Contacts directory and Contact categories. The implementation exposes the related records as simple, separately permissioned screens using the established Overview, protected Sheet, search, add/edit, review/confirmation, CSV and flat print patterns.

| Screen key | Screen | Primary table | Lookup / related reads |
| --- | --- | --- | --- |
| materialContacts | Contacts | contacts | contact_items, contact_extra for counts |
| contactPeople | Contact people | contact_items | contacts |
| contactDetails | Contact details | contact_extra | contacts |
| contactBankAccounts | Contact bank accounts | contact_bank_account | contacts, bank_account_type, attachments |
| contactCategories | Contact categories | contact_purpose | supplier / employee role records for usage count |
| bankAccountTypes | Bank account types | bank_account_type | None |

Contacts replaces the former Inventory “Supplier contacts” navigation entry while retaining its `materialContacts` resource key, hashes, record IDs and saved presentation preferences. The underlying company records remain shared with Fabric and Inventory suppliers. Company names, GST and search aliases are editable; people, phones/addresses, extra key/value details and bank accounts remain independent child records linked by contact ID. General Contacts and Bank account types do not expose bank values or bank-account counts.

## Contact Purpose in the live portal

The existing Overview and Sheet read Contact Purpose through `erp_contact_purpose_workspace`. The existing editor saves a single name through `erp_save_contact_purpose` after Review and Confirm. The database issues the ID and checks the previous revision before an edit. Names are required and checked case-insensitively for duplicates. Linked role counts cover the existing Fabric suppliers (yarn suppliers, knitters and dyers), raw-material suppliers and Employee primary/emergency purposes. Counts include only the corresponding screens the viewer can access. Renaming preserves the purpose ID and its foreign-key links. The exact `Employee` name is protected because registration uses it to set the required default. The screen supports view, create and edit under its own RBAC permissions.

## Original local pilot

Read-only Supabase schema inspection confirmed all tables, fields and FKs; no live database data or schema was changed. Bank account numbers are stored and projected as strings to preserve leading zeros. Supporting-document IDs are represented as attachment choices; authenticated file uploads remain pending. No real banking/contact details were fetched or seeded. Current and Savings are local sample account types. Existing local workspaces gain missing child collections without replacing their contacts or business documents.

Required contact links, account-type/document FKs and duplicate detail/account checks are validated before saving a copied workspace. Edits preserve unexposed existing attributes. New screens receive no automatic grants for existing Accounts/Viewer roles; administrator preview can configure access. Live login, server policies/save APIs, shared data and attachments are outside this local-screen change. Future server projections must limit contact and bank fields to each screen's actual needs.

Verification: full quality pipeline passed with 61 tests (lint, unused/duplicate checks, tests, production build). Browser checks confirmed Contacts under Miscellaneous without duplicate Inventory navigation; person add/review; separate bank-account form; protected Contacts Sheet with export/print controls and a flat print preview; and denial/hiding of Miscellaneous under the Accounts preview role. Browser QA did not save test contact or bank records.
