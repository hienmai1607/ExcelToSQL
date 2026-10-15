# Pallet material and accessory calculator

Deploy SQL 115 after 114, matching core and rebuilt webapp/dist, then restart the API. Applied locally only; deploy separately on the VM. Migration adds an immutable pricing-snapshot table and a nullable response selection. Existing responses are unchanged.

Next to Pallet size, open Pallet Pricing Calculator. Choose one active pallet price whose maintained Length and Width match the selected size, then optional accessory prices such as rigid corners and slip sheets. Pallet quantity is fixed at one; accessory quantity is consumption per loaded pallet. Current EA-priced materials are supported in this version, with one shared currency. Purchasing MOQ is displayed, not multiplied into consumption.

All three current pallet dimensions must be maintained in Packaging Pricing. Outdated dimension definitions, inactive vendors/materials/types, and prices outside their effective dates are excluded. Different vendor prices for the same size remain selectable.

For kg/EA tare, quantity multiplies maintained piece weight. For kg/m2 accessory tare, enter the consumed area per piece in m2; quantity multiplies that area. The pallet uses Length times Width. Missing tare stays unknown, not zero. Explicit zero remains valid. The calculator shows combined price and tare per pallet.

Calculate, Apply pallet pricing, then Review & save the response. Preview/apply rechecks price and material versions. The response transaction validates snapshot ownership and matching size; only assigned PIC or Admin in editable stages may save. Snapshots preserve consumed quantities, maintained tare, pricing and actor. Reset selection can discard obsolete selections.

Gross weight / Pallet (kg) = final-layer gross times cartons per pallet plus combined pallet/accessory tare. The selected pallet's base height is used; legacy records without a selection retain the former 150 mm default. Pallet height appears immediately left of Pallet height efficiency.

Save the response before launching 3D loading. The planner uses saved assembly dimensions and combined tare; container payload checks and saved totals include accessories. A saved assembly's USD total also supplies the default pallet cost in TCB (existing explicit costing overrides remain unchanged).

## Legacy mix weight correction

PCR-26641 was marked as a mix parent but had no ProductMixSnapshot. Its saved WeightGrams was 1190.67. Previously an empty mix aggregation replaced that known weight with unknown. Records lacking a snapshot now retain saved applicable weight or frozen product weight. If a snapshot exists but its constituents are incomplete, totals still remain unknown; partial totals are never substituted.

Checks: packaging_weight_contract (rollback SQL integration), pallet_pricing_contract, load_planning_contract/load_planning_sql_contract, packing_way_contract.Math; container-load, packing-way and load-planning browser specs; production build.
