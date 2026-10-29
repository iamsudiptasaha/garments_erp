# Colours section

The local business preview now has Colour library (name/Pantone), Colour mappings (colour/brand pair), and Lab dips. Swatch/approval/dyer/shade-card controls are removed from master/mapping forms; these belong to lab-dip editions and versions. No synthetic colour previews are drawn.

Lab dips have protected Sheet and Overview cards opening a progress modal. Cards identify the colour, brand, dyer, edition and latest interpreted status. The modal shows version workflow positions and selectable version details (date, shade card, registered attachment reference, comments, recorded/updated times). The workflow map is not a historical event log; that feature is deferred. The Attached Swatch route does not require the buyer-review stages.

Dedicated review-before-save editor creates editions, updates only the latest uncompleted version, adds sequential versions, and starts a new edition after completion. The three accepted outcomes close the edition. Colour and dyer are fixed within an edition; swatch boolean is derived from its status. Edition/version numbering is automatic within the appropriate parent. Legacy browser references are upgraded without inventing approval status or timestamps.

This remains local browser persistence, even on the signed-in route. No new live business-data API, uploads or shared formatting persistence is claimed. Shade attachment selection uses existing registered local references only; live Storage integration remains pending. Existing local dyeing-program/batch compatibility fields remain until that UI is migrated to the exact-version selectors. They are not reintroduced in the revised live database.

The live permission catalogue includes the Lab dips screen and its table dependencies. No custom role receives automatic permission. Database status-history tracking remains deferred. Full app quality checks and dedicated lifecycle tests passed; browser checks covered expansion and an unsaved status review.
