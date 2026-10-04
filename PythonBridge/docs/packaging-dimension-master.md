# Packaging Dimension Master

Current rules are documented in [Packaging formula roles](packaging-formula-roles.md)
(migrations 80 and 81): Shipping parents own occupied m²/m³; children own independent
supplier dimension names, units and Convert from parent / Convert from supplier formulas. The legacy formula fields
and deployment notes below describe earlier migrations, not the current editor.

Web-only dimension **definitions**, not stored numeric measurements.
Admin and Packaging can create/edit/block records; PackagingManager can view and
use Test Calculation. Existing Layout and Excel Local Update workflows are unchanged.

## Definition fields

- Packaging Type: all active types, Primary or Secondary, with any Price Basis.
  Parent and child types are both eligible; hierarchy does not restrict this dropdown.
  Blocked existing assignments remain visible but cannot be newly selected.
  Select an active type before saving Active. Blocking the unchanged existing assignment is allowed.
- D1: a dimension name such as Length; required, up to 100 characters.
- D2, D3: optional dimension names such as Width, Height or Gusset.
- D1 Unit, D2 Unit, D3 Unit: separate dropdowns from UoM Master.
  A named dimension requires a unit; an unused dimension has neither.
- Square meter formula: up to 200 characters; D1, D2, D3, decimal numbers,
  parentheses and + - * /. Required and shown only for Square meter Price Basis.
  Count and Volume definitions can be saved without a formula.
- Status: Active or Block. Creator/editor and timestamps are stored; RowVersion protects edits.

### Shipping formulas (migrations 73 and 74)

Shipping types require all three dimension names and units. Square-meter formulas
are also available for Shipping Count/Volume types. **Volume formula** is an optional
Shipping-only field with the same safe arithmetic syntax, up to 200 characters.
Its result is in cubic metres (m³). For dimensions in mm, a rectangular volume
formula is `D1*D2*D3/1000000000`; D1=200, D2=100, D3=50 gives 0.001 m³.
Include conversions explicitly for other or mixed units.

Test Calculation can test either formula independently or both together. Results
and sample measurements are never saved. PackagingManager can test stored volume
formulas but cannot edit them. Volume is distinct from Product Info's density-based
Used volume (ml); this change does not alter that product calculation or pricing.

Apply `sql/74_packaging_dimension_volume_formula.sql` after 73. Existing rows start
with no volume formula; repeated migration preserves saved formulas. Older clients
that omit VolumeFormula preserve its current value. Shipping clients can explicitly
clear it with null. Disabling Shipping hides and ignores an existing volume formula
without deleting it; new non-Shipping volume formulas are rejected by SQL.
Preview API: `/api/packaging/dimensions/preview-volume`, with VolumeFormula and
temporary TestD1–TestD3, returns CubicMeters and CalculationStatus.

The formula must only refer to dimensions defined in the master. D3 can stay blank
when the formula only uses D1/D2. A definition can be saved without entering test measurements.

## Test Calculation

Expand Test Calculation in the editor, or use the Test calculation action in the
first table column. These are available only for Square meter types.
Enter temporary positive measurements for variables used by
the formula (up to 12 whole digits and 6 decimal places), then click Test calculation.
The read-only result displays up to 9 decimals in m².

Measurements are used **directly in their selected units**. There is no automatic
conversion to metres, nor any dependency on Unit Conversion Master factors.
The formula itself must include any unit conversion and offsets.

Example:

- D1 = Length, unit mm; D2 = Width, unit mm; D3 unused.
- Formula: (D2*2+25)*D1/1000000.
- Test D1 = 200, Test D2 = 100 → **0.045 m²**.

Here 25 is a millimetre allowance, and division by 1000000 converts mm² to m².
For mixed units, include the required conversion explicitly in the formula.

Test values and results are never stored or sent with a master save, and changing
the definition or a test value clears the previous result. PackagingManager's
Test Calculation dialog keeps definition fields disabled and has no Save action.

Expressions use a bounded allow-listed arithmetic parser with Decimal arithmetic.
No Python/JavaScript eval or dynamic SQL expressions are used. Unsupported names,
functions, operators, missing test values, division by zero and nonpositive/overflow
results produce an error. The application cannot infer physical units or whether a
custom formula correctly calculates area; users should verify their formula.

## Migration and preservation

Run sql/60_packaging_dimension_definitions.sql after migration 59.
Then apply migrations 61 and 62 in order. Migration 61 removes the old parent-only
trigger; sql/62_packaging_dimension_all_types.sql allows all active types and makes
the formula optional for non-Square meter types. Existing formulas remain stored
but are hidden and unused when the type has another Price Basis. New non-area
definitions store no formula. No Packaging Type Price Basis is changed automatically.
It is repeatable and preserves prior numeric D1–D3 values, original UoM code snapshots
and the original formula. Earlier records receive placeholder dimension names and
a Formula review required flag. Review the names/formula for input-unit semantics
and tick the review confirmation before saving an Active legacy record. Original
archived numeric values, units and formula remain unchanged by later edits.

New records store names in D1Name–D3Name; the API exposes them as D1–D3. Legacy
numeric columns are nullable and receive no test values. No master records or
conversion factors are seeded.

## VM deployment

1. Apply migration 62 after 61 (and 59/60 if not already applied); adjust USE [test] if needed.
2. Copy core/dimension_formula.py and core/packaging_dimension_api.py, and rebuilt webapp/dist.
3. Restart the API and refresh the browser (Ctrl+F5).

The prior main.py router registration remains unchanged.

API: /api/packaging/dimensions, /lookups, /preview.
The preview request includes TestD1–TestD3; the save API forbids those extra fields.

## Verification

- tests/python/packaging_dimension_contract.py: formula/SQL/API tests, rollback-only fixtures,
  including repeated migration, legacy preservation, scope enforcement and stale versions.
- webapp/tests/packaging-dimensions.spec.ts: browser tests including the user's
  mm formula, optional D3, read-only testing, sample isolation and 1920×1080/narrow displays.
- TypeScript/Vite production build.
