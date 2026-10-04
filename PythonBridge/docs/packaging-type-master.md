# Packaging Type Master

Admin and Packaging can maintain records. PackagingManager can view and export.

Required inputs:

- Order: Primary or Secondary.
- Packaging Type: user-maintained name, up to 100 characters.
- Price Basis: Count, Square meter or Volume.

Optional Parent Type selects an existing type or None (root type). See
[Packaging Type hierarchy](packaging-type-hierarchy.md) for validation, Excel
updates and SQL 54 deployment.

Each Order / Packaging Type combination is unique. The same type name can be
used under both Primary and Secondary. D blocks a record; edits use RowVersion
to protect against concurrent changes. No default business records are seeded.

The webapp supports batch create, edit, saved layouts, sorting, filters and
Excel export. Excel Local Update supports the same three inputs, Parent Type and Status.
Enter the exact Order and Price Basis choices in Excel. Audit fields are read-only.

## Deployment

Run sql/51_packaging_type_master.sql after SQL 50, choosing the intended database
in the USE statement. The migration is rerunnable and preserves existing rows.
Deploy the updated core files, webapp/dist and templates/Packaging_Master_Local_Update.xlsm.
Restart the API, refresh the browser and download a fresh Packaging_Type_Local_Update.xlsm.
Implementation updates the local test database only; the VM is unchanged.

After SQL 54, run SQL 55 (`sql/55_packaging_type_retire_tare_weight.sql`) to
retire Tare weight. It is no longer shown, editable or required. Historical database
values are retained and left unchanged by type edits; new records use zero in the
legacy column. Saved layouts automatically discard the retired column, sort and
width settings. Download a fresh workbook; retired field edits from older
workbooks are rejected.

This introduces the master section only. It does not change existing Opportunity
Packaging type or Packaging Request response fields into dropdowns in this release.
