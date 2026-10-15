# Material tare and gross weight

Deploy SQL 112 after 111, matching core files and the rebuilt webapp/dist; restart the API. SQL 112 adds nullable TareWeight (kg) and TareWeightBasis to PackagingMaterial. Existing materials stay unknown until maintained. The local test database has been upgraded; deploy the migration separately on the VM.

## Maintain and calculate

In Packaging Material, enter tare weight and choose kg/EA or kg/m2. Enter both values or clear both. Explicit zero represents a known zero tare. Pallets use the same material fields. These fields are also available in the Packaging Material local Excel template; Raw Material is unchanged.

Recalculate and apply pricing for each layer, then Review & save the response. Each component captures the material tare, basis, row version, quantity and calculated consumption area. Historical pricing keeps the values it captured. Material changes take effect in a new calculation; they do not silently rewrite old responses.

For kg/EA, tare equals the material's weight times the consumed piece quantity. For kg/m2, tare equals weight times the consumed material area, including component quantity. Film area comes from the existing reviewed Convert from parent formula with output in square metres, not from occupied shipping area or vendor price/MOQ. A piece-count conversion is not treated as square metres. A kg/m2 material needs a valid area calculation; missing area leaves tare incomplete.

Example, Length D1 = 100 mm, Width D2 = 50 mm:
- Formula: (D2*2+15)*D1/1000000.
- Consumption: 0.0115 m2 per pillow.
- At 1 kg/m2: 0.0115 kg per pillow.
- Ten pillows inside one carton with 3 kg/EA tare add 3.115 kg packaging weight.
- At 0.1 kg product per pillow: carton gross = 1 + 0.115 + 3 = 4.115 kg.

Secondary gross equals Primary gross times No of Primary Unit plus Secondary tare. Tertiary repeats this using No of Secondary Unit. Material component quantity belongs inside one layer; the response unit counts multiply the contained layer, preventing duplicate carton tare. Missing tare propagates as unknown, not zero. Changing the confirmed layer count preserves known per-unit tare for unchanged packaging types and recalculates active-layer gross weights from the current counts. Height highlighting applies only to the final layer of a parent response; child item heights are not highlighted.

## Pallet and container

The 3D planner defaults to Calculate gross weight from saved response. It loads the saved final-layer gross weight; save layer pricing and response quantities first. The server derives it again for preview/save and rejects incomplete gross weight. Manual measured carton gross remains available by clearing that option.

Selecting a pallet material price copies dimensions and material tare into the planner and locks those inputs. Pallet kg/EA uses its maintained piece weight; kg/m2 uses its length times width footprint in m2. Missing pallet tare remains unknown. Concurrent changes to selected pallet material are rejected.

Loaded pallet gross = cartons per pallet times carton gross + pallet tare. Container cargo gross sums loaded pallet gross, or loaded carton gross for floor loading. This is cargo gross, excluding the empty container's own weight. Payload checks use the same gross values. The layer, pallet and container weights appear in the response/planner.

A saved plan captures the weight inputs and totals. If response gross changes before plan selection, recalculate the plan. Editing applicable net weight or packing geometry clears the staged selection. Historical plans retain their captured results.

## Verification

- Python: packaging_weight_contract, load_planning_contract, load_planning_sql_contract, packing_way_contract.Math, pkg_pricing_contract.Math, packaging_master_excel_contract, packaging_master_web_contract.
- Browser: masters.spec.ts, load-planning.spec.ts, container-load.spec.ts.
- npm.cmd run build.

## Mix parent contents

Primary gross of a mix parent = sum(captured child mix quantity × child final-layer gross) + parent Primary tare. Higher parent layers multiply and add their own tare normally. Unknown child gross/tare propagates; it is not treated as zero. Legacy net weight stays visible, and child quantities come from frozen opportunity links when composition JSON is absent.

Live child weight, count and pricing changes update parent gross in the editor. Saved reads and 3D loading use the same rule, scoped to the same parent and request. Save all family responses before planning. Example: 16.518 + 14.259 kg child gross + 5 kg parent tare = 35.777 kg.
