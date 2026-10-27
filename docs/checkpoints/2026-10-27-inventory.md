# Fabric, Inventory and access preview checkpoint · 27 October 2026

This checkpoint includes the Fabric reference screens (yarn types, fabric types, brands), sheet multiline/zoom improvements, Employee/HR separation, admin-only access preview, and Raw Material Inventory screens.

Inventory covers materials, suppliers/contacts, purchase orders, receipts, outward entries, available stock, movement history, categories, units and outward types. Receipt entry starts from a purchase order or fabric batch. Fabric receipts clear supplier/PO fields; PO receipts select the order's supplier and exact ordered item. Reconciliation writes a separate outward entry closing the remaining quantity to zero, retaining history. The default production outward type is labelled “Production assigned.”

All data and permissions are local previews. Live authentication, database RBAC, shared persistence and attachments remain pending. SQL under `database/drafts/` is unapplied review material. The latest user-management diagram is supplied for the next review; this checkpoint does not implement that new design.

Validation: full `npm run quality` pipeline (lint, unused-code detection, duplicate-code scan, tests, build), plus browser checks of receipt path switching, inventory Sheet/print, reconciliation review, HR navigation and admin access guards.
