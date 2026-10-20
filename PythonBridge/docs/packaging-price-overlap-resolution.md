# Packaging price overlap resolution

Migration 133 removes the INSERT-EXEC call between Pricing V6 and V5. V5 retains its normal result-set contract for existing callers, and offers an optional JSON output parameter for V6. Row validation can now roll back safely and return the original error. Active overlapping prices report **Price ranges overlap**.

New Packaging Pricing records have an unchecked **Resolve overlap automatically** option. The save confirmation warns that existing prices may be end-dated. The API accepts `ResolveOverlap` on new Packaging Price rows only.

Resolution is limited to active prices for the same Material, Vendor (including no vendor), currency and Price UoM:

- A new lower quantity tier is capped at the smallest higher existing Quantity From whose dates intersect. Quantity To is exclusive.
- A new open-ended price replacing an identical quantity tier ends older matching prices the day before the new Effective From. Effective dates are inclusive.
- Remaining overlaps are still rejected. Same-day replacements, partial replacements of a lower tier, and finite replacements that would discard old future prices require explicit manual ranges.
- Resolution, validation and creation run within the row transaction, under update/serializable locks. A failed row undoes its adjustments. Existing IDs and references are preserved, with UpdatedBy/UpdatedAt and row versions updated normally.
- Migration deployment itself changes procedures only; it does not resolve or alter any existing price records.

Example: existing quantity [1000, unlimited), effective October 19 onward:
new quantity 1 from October 21 becomes [1, 1000), leaving the existing tier untouched.
New quantity 1000 from October 21 instead ends the old tier October 20, and starts the replacement October 21.

Verification:
`PYTHONPATH=core;tests/python python -m unittest price_overlap_contract` (PowerShell: set the environment variable separately).
`npm --prefix webapp test -- tests/masters.spec.ts`.
All SQL fixture writes are explicitly rolled back.
