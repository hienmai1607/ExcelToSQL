# Packaging formula roles

Apply migration 80 after 79, then migration 81. The four formulas are independent; occupied shipping
space must never double as material consumption.

| Formula | Scope | Measurements | Output / use |
| --- | --- | --- | --- |
| Occupied m² fx | Shipping parent only | Response calculator parent D1–D3 | Footprint of one unit in m²; Pallet Utilization |
| Occupied m³ fx | Shipping parent only | Response calculator parent D1–D3 | External volume of one unit in m³; Carton Efficiency |
| Convert from parent fx | Child only | Response calculator parent D1–D3 | Material required per child occurrence |
| Convert from supplier fx | Child only | Supplier D1–D3 on one price/tier | Material supplied per ONE Price UoM |

Both child formulas output the same material basis: m² for Square meter pricing,
or the material's base units for Count. The application supports these two
pricing bases; occupied m³ does not introduce Volume-basis material costing.

Child cost = N × Convert from parent × Vendor unit price / Convert from supplier.
Parent price is the sum of child costs, with existing currency normalization,
MOQ/tier validation and decimal rounding. N is separate and must not be included
again in a conversion formula.

For example, a film occurrence requires 0.045 m², and one metre of supplier film
provides 0.5 m². At 10,000 VND/metre and N=1, the child cost is 900 VND. The carton
footprint and volume can independently be 0.02 m² and 0.005 m³.

Parents and children maintain independent names and units. A child's own definition
describes supplier measurements for one Price UoM; it is editable and is never
overwritten by a linked parent. Convert from parent uses the linked parent's names,
units and calculator measurements. Convert from supplier uses the child's own
names, units and supplier measurements. Child D3 is optional, even when its parent
is Shipping; the fixed D3 Height rule applies only to Shipping parents. Include raw-unit
conversion explicitly: mm² / 1,000,000 or mm³ / 1,000,000,000. No formula inherits
another role. Constant child conversions such as 1 or 10 are allowed; computed
conversion values must be positive and finite. Ordinary Count children without
a consumption formula use 1, and retain existing Count Unit Conversion when no
supplier geometry is maintained. Quotes already in the canonical base unit use 1.

The calculator automatically selects a sole child conversion definition linked
to its selected parent geometry. Multiple definitions require an explicit child
selection. Child measurement inputs are not shown in the calculator. Supplier
measurements are maintained on Packaging Material Pricing; its calculated
conversion factor is readonly, including Excel Local Update. The internal
SupplierAreaPerPriceUnit column name is retained for compatibility, but now holds
a material-basis supplier factor (m² or Count base units).

Only the last confirmed Shipping layer requires positive parent D3 Height;
intermediate formulas require D3 only if they reference it. Shipping height and
Layers / pallet still use physical D3, not any occupied-volume formula result.
Efficiency uses the final layer's captured occupied formulas and parent values.

New snapshots retain both child formulas, independent parent/supplier values,
vendor prices/UoMs, factors, occupied formulas and results. RowVersion and
fingerprint validation prevent stale application. Historical JSON remains
immutable, and legacy snapshots continue to use their original captured formulas.

## Migration safety

Migration 81 removes automatic parent-to-child metadata copying and updates save,
preview and supplier validation for independent definitions. It changes procedures
and triggers only; existing definitions, rowversions, requests and prices are untouched.

Migration 80 archives definition before-images in PackagingFormulaRoleMigrationLog.
It copies existing parent consumption into child Convert from parent, and existing
child supplier conversion into Convert from supplier. It preserves legacy columns.
An existing Shipping parent Volume formula becomes Occupied m³. Parent area is
not silently copied into Occupied m²: it starts blank and requires review where
a legacy parent area existed. PackagingFormulaRoleMigrationState prevents reseeding on rerun.

Request headers, items, change logs, pricing snapshots and vendor prices are not
deleted or rewritten. Existing supplier definitions get new RowVersions; refresh
and review Packaging Material Pricing before recalculation. Deploy the updated API
and rebuilt webapp/dist together, restart the API, and refresh the browser.
