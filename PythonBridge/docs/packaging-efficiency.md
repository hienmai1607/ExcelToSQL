# Packaging response efficiency

Both response editors share the same derived fields; Opportunity and Packaging
request item tables expose them in Packaging Responses. Net weight appears beside
each layer's unit count. The duplicate price/save notes under Type are removed.

Packing Way displays **Shipping height (mm)** beside the last confirmed layer's net weight (Primary, Secondary, or Tertiary). It remains readonly and comes from that layer's Shipping pricing D3.

Each layer also displays its captured parent dimensions on two lines, for example
**Length × Width × Height** and **100mm × 200mm × 300mm**. Names, units, and values
come from the applied or saved pricing snapshot, not current Packaging Master data.
Unentered dimensions (including optional D3) are omitted. Older snapshots without
parent measurements show an empty Dimensions placeholder until pricing is applied.

Palletization adds **Pallet height (mm)** = 150 + Layers / pallet × Shipping height (mm).

The **Efficiency** section contains:

- Carton Efficiency (kg/m3) = final layer net weight (g) / 1000 / Shipping parent Occupied m³ fx.
- Relative carton efficiency % = Carton Efficiency / Nut Density (g/ml) / 1000 × 100.
- Pallet Utilization % = Shipping parent Occupied m² fx × Cartons / layer / pallet area (m²) × 100.
- Pallet height efficiency % = Pallet height / Max pallet height × 100.

All three percentage fields display exactly two decimal places in response editors
and item tables. Calculations and saved/read values retain their original precision;
rounding is display-only and is performed directly from the full-precision result.

Area and volume use the last confirmed Shipping layer's **occupied parent** formulas, evaluated using
the captured measurements and original units. Formula definitions already output m²
and m³; do not sum child material areas or infer carton volume from product density.
Applying pricing updates these values immediately. Saving preserves geometry in the
existing immutable pricing JSON; reopening uses that saved geometry, not changed
master definitions. Older parent snapshots can be evaluated without rewriting history.

Pallet area comes from Pallet Master's validated PalletAreaMM2 divided by 1,000,000.
Unmatched legacy pallets, missing formulas/measurements, zero denominators and
unreviewed definitions leave dependent results blank. Values above 100 are not capped.
Changing confirmed layers or final type prevents reuse of mismatched saved geometry.
Derived fields are never sent as editable response columns. Draft read permissions
also guard geometry and efficiency in both entities.

Migration 80 adds the distinct occupied formulas; see packaging-formula-roles.md.
Efficiency results remain derived on read from immutable pricing snapshots.
