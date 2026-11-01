# Employee / HR

Local on `dev`; production has not been changed. Release requires the reviewed Employee migration and matching UI through GitHub CI/CD.

Employee owns its own fields only. The editor selects existing `contacts_id` and `contacts_emergency_id` records and their contact-purpose foreign keys. Contact names, phone/address details, bank accounts and bank supporting documents are maintained centrally in Contacts and its related screens. Employee commands cannot create, edit or delete those records. A read-only linked contact summary can be shown in the directory. Gender, blood group and employment type have separate, explicitly scoped reference-maintenance commands.

The corrected migration retains generated employee codes, private employee document slots, revision conflict checks and immediate verifier password confirmation. It rejects nested contact/bank payloads. The verifier's separate memory-only session never replaces the operator's login; its single-use proof binds the exact Employee payload to the operator and selected verifier. Saving still requires the operator's current MFA session and Employee write permission. No pending approval queue exists. The proposed ERP-wide activity-history design remains a separate, unimplemented proposal.

`employee_photo` remains the database's text reference field. No conversion into an attachment FK has been invented. Existing contact-bank supporting documents are neither copied nor modified by Employee.
