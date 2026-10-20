# Material dimensions and Palletization upgrade

Baseline: database migrations through 116 and the matching application release.

## Deployment

Back up the database and stop application writes. Apply these files, in order:

1. sql/117_clearance_per_container.sql
2. sql/118_material_owned_dimensions.sql
3. sql/119_palletization_material_selection.sql
4. sql/120_business_deletion_audit.sql

Deploy matching Python and webapp/dist files, then restart all API workers. Each migration has its own transaction and is repeatable; the four-file upgrade is not atomic. Do not deploy the new application against the old schema. These scripts were tested with rollback fixtures, not applied to the running desktop or VM database.

## Business behavior

- Physical measurements are maintained on Packaging Material only. Pricing no longer accepts independently entered material/supplier dimensions. Legacy database columns and immutable snapshots remain for historical compatibility.
- Migration 118 copies a unique existing material-dimension tuple from pricing to its material. Conflicting tuples are not arbitrarily selected. Review materials marked MaterialDimensionsNeedsReview and materials whose old measurements existed only as supplier dimensions. Re-enter their dimensions on Packaging Material.
- After a dimension definition changes, re-enter material measurements against the current definition. Existing immutable pricing/load snapshots retain their captured values.
- Palletization is the displayed category (legacy internal token: Pallet). Only active Single Type Pallet materials with complete current dimensions and active pricing appear as base pallet choices. Palletization accessory types, such as rigid corners and slip sheets, appear in the pallet pricing calculator but cannot be selected as the base pallet.
- Selecting a base material records its identity and footprint; changing it invalidates dependent pricing/loading selections. A previously saved legacy footprint is displayed as retained until a material is selected.
- Viewing a successful container row captures its server-derived load snapshot automatically. Background comparison rows are not captured until viewed. Re-viewing a row reuses its snapshot. Normal response Review & save persists the captured selections; read-only viewers never capture snapshots.
- Import clearance uses customer currency per container. Calculations convert that amount to USD and divide by container units. Historical customer-currency/pallet values retain their original meaning until explicitly replaced.

## Verification

Focused SQL contracts cover material ownership, stale/wrong definitions, Palletization accessories, selected base identity, and migration repeatability. Browser tests cover automatic viewed-row capture, revisits, material versus pricing inputs, and customer-currency/container entry.

## Business record deletion

Approved scope: business modules only, excluding Admin masters.

Trash icons are available to editors for Customers, Products, Packaging Material/Pricing/Types/Dimensions, legacy Pallets, Raw Material/Pricing/Grades, Vendors, material-specific unpaired conversions, and draft Opportunity / unprocessed Packaging Request headers and lines. Admin-maintained users, roles, access, markets, currencies, units, container types, categories, loss processes, ports and general conversions are excluded even for Admin.

Trash icons stay hidden until a read-only, batched server eligibility check confirms deletion is available. Failed checks also leave the icon hidden. Eligibility is advisory; the delete operation independently rechecks all rules under transaction locks.

Deletion requires explicit confirmation and the displayed row version. The server revalidates page-edit permission, active identity, transaction creator (or Admin), current workflow and prior processing history. A reverted draft is still protected. The request database's initial stage is Assigned even before PIC assignment; only initial Assigned lines with no PIC, submission, review or calculation history qualify. Inbound foreign keys, including cascading ones, logical name/footprint references and saved business JSON are checked under transaction locks. Invalid saved JSON blocks deletion rather than assuming no references.

There is no bulk delete or business-record cascade: remove eligible unprocessed child lines separately before their empty header. Type-order attributes alone are removed with their type. Immutable snapshots and history are never deletion targets; their references prevent deleting a connected master or transaction.

Successful deletions and their actor/identity/version/label are recorded in BusinessDeletionAudit in the same transaction. This audit is not a restore mechanism. Permanent deletions cannot be undone through the application. Network-unknown outcomes require refresh before another attempt.

Deletion checks deliberately prioritize safety: JSON and unindexed reference checks may lock larger ranges. Use a quiet period for cleanup on large databases; do not bypass a blocked reference by removing history.
