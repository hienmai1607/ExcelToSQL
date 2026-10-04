# Packing Way in Packaging Response

Webapp workflow only. Layout columns, workbook templates and local-update macros are unchanged.

## Units and weights

Packing Way sits immediately below Confirmed packaging layers.
The layer count refers to packaging layers, not the number of pallet stacking layers.

- 1 packaging layer: No of Primary Unit = 1, read only.
- 2 packaging layers: No of Primary Unit is entered; No of Secondary Unit = 1, read only.
- 3 packaging layers: Primary and Secondary unit counts are entered; No of Tertiary Unit = 1, read only.

Primary units count how many Primary packages fit inside one Secondary package.
Secondary units count how many Secondary packages fit inside one Tertiary package.
The count of the final package is always 1. Missing non-final counts can remain blank
in a draft; they remain required for submission under the existing layer workflow.

Each packaging section shows its net weight in grams, read only:

- Primary = request product net weight.
- Secondary = Primary net weight x No of Primary Unit.
- Tertiary = Secondary net weight x No of Secondary Unit.

Palletization retains Cartons / layer and Layers / pallet.
A carton here means one unit of the final confirmed packaging layer, even if its
Packaging Type is not literally a carton.
Net weight per pallet (kg) = final-layer net weight (g) x Cartons / layer x Layers / pallet / 1000.
Packs / pallet is retained as the existing independent field; it does not drive this calculation.

Container totals are described in [Container loading](packaging-container-load.md).
The final layer's net weight is also used for Floor load; pallet container weights
use the net weight per pallet calculated here.

For 10 g product weight and 10 x 5 x 1, net weights are 10 g, 100 g and 500 g.
10 final units per pallet layer and 5 pallet layers gives 25 kg per pallet.

## Storage and assurance

Existing response columns are reused; no duplicate relationship columns are created:

- UnitsPerCarton stores No of Primary Unit (Primary per Secondary).
- UnitsPerTertiary stores No of Secondary Unit (Secondary per Tertiary).
- The final unit count is derived as 1, never editable or independently stored.
- CartonsPerLayer and LayersPerPallet retain the pallet factors.

The old input controls move out of Secondary/Tertiary packaging into Packing Way.
Only the web labels change. Existing counts appear automatically in the new section.
Lowering the confirmed layer count clears inactive counts through existing SQL logic.

Weights are derived server-side on request reads and live in the browser using exact
decimal arithmetic, not binary floating point. WeightGrams is the request's captured
product weight: later Product Master edits never change it. Derived output fields are
not accepted as response inputs. Missing/invalid factors yield blank weights, never
guessed zeros. Counts must be positive whole numbers within the SQL INT range.
New derived response outputs follow existing draft/approved visibility rules.

SQL 69 adds matching direct-SQL count validation to the existing guarded response
save procedure. Authorization, row-version checks, stage restrictions, immutable
request snapshots and existing count-change audit logs are preserved.
No stored pricing snapshot is rewritten or recalculated.

## Deployment

1. Back up the VM database and pause API writes.
2. After migrations through 68, run sql/69_packing_way.sql against the intended database.
3. Deploy core/packing_way.py, core/packaging_fields.py and core/request_views.py with the
   matching webapp/dist folder. Restart the API and hard-refresh the browser.
4. Verify existing counts, all three layer choices, final unit fixed at 1, layer weights,
   pallet weights, a save/reload and a read-only approved response.

Migration 69 was applied only to the local test database; the VM was not changed.
Regression contracts: tests/python/packing_way_contract.py and webapp/tests/packing-way.spec.ts.
Default desktop verification uses 1920x1080.
