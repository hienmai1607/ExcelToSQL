# Packaging Type parent relationship

Packaging Type Master now has an optional **Parent Type** column and dropdown in
its create/edit form. Pick an existing active type or **None (root type)**. Choices
show `Order / Packaging Type`; either Primary or Secondary can be a parent.
Admin and Packaging maintain types; PackagingManager remains read-only.

Self-parenting and circular relationships are rejected. The web editor disables
descendants, and SQL validates the hierarchy under a transaction-owned lock.
Existing types remain roots. Blocking a type does not delete its relationships:
an unchanged blocked parent is preserved, but cannot be assigned to another type.

Excel Local Update includes **Parent Type**. Enter `Order / Packaging Type` to
assign a parent; a name alone works only if it identifies exactly one active type.
Clear the cell to remove the relationship. Unrelated edits, including requests
from older clients that omit the parent field, preserve the existing parent.

This change does not restrict Packaging Material assignments or Primary/Secondary
response dropdowns to leaf types.

## Deployment

Run `sql/54_packaging_type_parent.sql` after migration 53, against the intended
database (the script currently selects `test`). It adds nullable `ParentTypeID`,
its foreign key, index and self-reference check, and updates the batch procedure.
It is safe to rerun. Deploy the updated core files and rebuilt webapp distribution,
then restart the API service. Existing adaptive Excel templates need no VBA change;
download a fresh workbook for the new column.
