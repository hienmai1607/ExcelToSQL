# Local PET jar consolidation

`sql/data/merge_pet_jar_16_into_74032.sql` is a targeted business-data migration,
not a general installation migration. It validates the exact local IDs and dependency
shape before any change and runs transactionally under the type hierarchy lock.

Canonical PET jar is #74032: active, Shipping true, Primary and Secondary orders.
Existing children #74033 through #74036 and their material links remain intact.
Dimension definition #37112 moves from #16 to #74032, preserving its names, units
and formulas. The blocked root #16 becomes `PET jar (legacy #16)`; its unused
duplicate Lid #210 and Seal #211 are blocked, not deleted.

Existing request and pricing snapshots are not rewritten. The complete before-image
of affected type, order and dimension records is retained in `PackagingTypeMergeLog`
with timestamp and administrator attribution. Re-running the migration checks
postconditions and does not merge or archive anything twice.

Recovery is possible using that before-image, but must first check for new business
references created since the merge. Do not blindly restore a stale before-image.
