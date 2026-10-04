# Parent packaging dimensions and pricing

Current behavior is described in [Packaging formula roles](packaging-formula-roles.md)
(migrations 80 and 81). Parent occupied m²/m³ are shipping space; children have two explicit
conversion formulas. Child supplier names, units and values are independent of the parent.
The inheritance and conversion rules below are historical migration-77 notes.

Migration: `sql/77_packaging_parent_dimensions.sql` (after 76).

## Master data

Parent/root types own dimension names and units. A child component may have a formula
override linked by `ParentDimensionID`. Its names and units are copied from that
root definition, cannot be maintained independently, and follow subsequent parent
changes. Nested children use a root definition, not a separate intermediate geometry.

Child Square meter and Volume formulas are independent overrides. A blank override
inherits the parent formula. Volume formulas remain available only within Shipping
type families. Temporary master formula previews use the inherited units directly;
the formula must include the conversion to m² or m³.

Shipping definitions have D3 fixed as Height. Existing Shipping definitions with a
different physical D3 must be reviewed before applying the migration; a gusset must
not be silently reinterpreted as height.

The migration preserves each existing child definition and its formulas, creates
matching parent definitions when necessary, and links them. Distinct geometries are
not merged. Before-images of migrated child rows are retained in
`PackagingDimensionInheritanceLog`; historical pricing JSON is never rewritten.
Rerunning 77 does not create duplicate definitions.

## Calculator

Measurements are entered once in the Parent dimensions section. The calculation
input has top-level `DimensionID`, `DimensionRowVersion`, and `D1`–`D3`.
Component measurement values must be blank. Component `DimensionID` may select a
child formula override (or the selected root definition), not another geometry.

Square-meter consumption automatically evaluates the nearest active child formula,
falling back to the parent formula, against the parent measurements. Multiple
same-level overrides require a choice. Active vendor/base-unit conversions still
apply. Parent and child row versions and effective formulas are captured in the
pricing fingerprint and immutable snapshot.

Only the last confirmed Shipping layer requires positive D3 Height, including
Count-basis components (Secondary for two layers, Tertiary for three). Intermediate
layers do not require Height unless a component formula references D3. All other
formula-referenced measurements remain required. Final-layer Height is converted to mm
using mm/cm/m units or an active general conversion to mm. The existing HeightMM
storage limit remains positive DECIMAL(12,2); values needing finer mm precision
are rejected, not rounded into a potentially incorrect pallet-layer count.

New saved setups/references restore the single parent entry. Older component-level
measurements remain readable in history, but must be re-entered at parent level.
Changed master definitions require re-entry/recalculation.

Selected component cards align side by side and wrap to fewer columns on smaller
screens. Each card keeps its quantity, child formula and calculated values together.

## Response and pallet calculation

Only the final confirmed Shipping layer supplies `FinalLayerHeightMM`.
Intermediate-layer pricing cannot overwrite the response height.

Applying that calculation displays the resulting read-only Height (mm) in both
response editors. Saving independently revalidates pricing and writes HeightMM,
pricing snapshot, and the derived pallet count in the existing audited response
transaction. A conflicting explicitly supplied height is rejected.

`LayersPerPallet = floor(max(0, MaxPalletHeightMM - 150) / HeightMM)`

Changing the final type or confirmed layers clears geometry pending new pricing.
Older saved/manual heights are not erased merely by opening a response or making
an unrelated edit. Read-only height is not resubmitted over a new calculation.

Verification: `tests/python/parent_geometry_contract.py`,
`tests/python/pkg_pricing_contract.py`, and the packaging-dimensions, pkg-pricing,
and packing-way browser specs.
