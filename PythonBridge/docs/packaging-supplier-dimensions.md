# Parent consumption and supplier conversion

Superseded by [Packaging formula roles](packaging-formula-roles.md), migrations 80 and 81.
Child Convert from parent now calculates consumption from parent measurements;
child Convert from supplier calculates supply per Price UoM. Parent occupied
formulas are shipping geometry only. Child supplier names and units are now independently
editable, not inherited. The following describes historical migration-79 behavior.

Apply migration 79 after 78. This replaces the previous use of a child formula
against parent response measurements for area consumption.

- Parent Square meter formula: m² required per one packaging unit. D1/D2/D3 values
  are entered once in the response Pricing Calculator.
- Child Square meter formula: m² supplied by exactly one vendor Price UoM.
  Supplier D1/D2/D3 values and a child definition are maintained per vendor/tier
  record in Packaging Material Pricing, not Unit Conversion Master.
- Dimension names and units still belong to the parent and are copied to child
  definitions. Child formulas may differ; a blank formula inherits the parent.
  Square meter formulas are available on all parent and child types.

Example: parent requires 0.02 m². Supplier film is priced per metre.
Supplier D1 = 1,000 mm and D2 = 500 mm with child formula
D1*D2/1000000 gives 0.5 m² per metre. Quantity 1 therefore consumes
0.02/0.5 = 0.04 m; at 10,000 VND/m, the packaging cost is 400 VND.

All formulas use the entered units directly. Include unit conversion to m² in
the formula. Only formula-referenced supplier values are required; Shipping D3
Height remains required in the response calculator only for the last layer.
Supplier measurements do not replace response shipping height.

Count pricing retains existing Unit Conversion behavior. Area-priced quotes
already expressed in m² use factor 1 (including supported square-metre aliases).
Other area quote UoMs require supplier geometry; no scoped Unit Conversion
factor is silently substituted.

New price columns are nullable and no business values are inferred or copied
from old conversions. Existing historical pricing snapshots are not rewritten.
Recalculating a metre-priced material requires reviewing its child formula and
maintaining its supplier dimensions first. A changed definition, inherited
geometry, blocked unit or blocked definition prevents use of a stale conversion.
Supplier definitions, values and factors are captured in new pricing snapshots.

Older clients/workbooks updating other price fields preserve supplier data.
Changing the material or Price UoM without new supplier geometry clears that
setup. Explicit blank supplier fields clear it. New Excel Local Update workbooks
support Supplier dimension ID and measurements, with the calculated factor
read-only. Raw Material Pricing is unchanged.

Migration 79 was applied to local DESKTOP-5BGMJSC / test. All 10 existing prices,
8 dimension definitions and 8 pricing snapshots were preserved. Deploy updated
core files and webapp/dist, restart the API and download a fresh pricing workbook.
Verification: supplier_geometry_contract, parent_geometry_contract,
pkg_pricing_contract, masters and packaging-dimensions browser tests.
