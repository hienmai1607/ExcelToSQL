# Packaging response defaults and palletization

Run SQL migration 72 after 71, then rebuild the web app and reload the API.

New requests initialize response packaging types, confirmed layers, non-final
layer unit counts, and pallet specifications from their request-time snapshot.
Existing editable requests receive missing defaults as a draft only. Existing
response values are preserved; after the first save, explicitly cleared values
stay cleared. Approved and other locked responses are never defaulted in the UI.

Response pallet specifications have independent columns:
ResponsePalletSize, ResponsePalletStacking, ResponseMaxPalletHeightMM. Editing
these never changes frozen requested values. Pallet size uses active Pallet
Master entries; stacking is Single/Double; height is a positive whole number of
millimeters. They remain visible and editable for Floor load. Existing unavailable
master values remain visible and can be retained on unrelated edits.

The three response pallet specifications appear before Cartons / layer and
Layers / pallet. Currency codes appear beside each calculated price.

Units / pallet is read-only and derived from the number of Primary units in the
last confirmed packaging layer, multiplied by Cartons / layer and Layers / pallet.
For one layer the unit multiplier is 1; for two layers it is UnitsPerCarton; for
three layers it is UnitsPerCarton multiplied by UnitsPerTertiary. Missing inputs
produce a blank value; calculations use exact integer arithmetic and do not
require a product weight. The old PacksPerPallet column remains for workbook
compatibility but is not the web calculation or an editable web field.

The API preserves existing ownership, concurrency, approval and audit controls.
New response specifications are masked from Opportunity-only readers until
approved. Item view layout version 6 includes the new response fields and derived
Units / pallet in both Opportunity and Packaging Request views.

Regression coverage: webapp/tests/response-defaults.spec.ts and
tests/python/response_pallet_defaults_contract.py (rollback-only SQL fixtures).

## Height-based pallet layers

Apply SQL 76 (`sql/76_packaging_pallet_layers.sql`) after 72/73 and reload the API.
Use the existing response Height (mm), now visible beside response pallet specifications,
as the height of the last confirmed packaging layer. No new height column is added.
It retains DECIMAL(12,2) precision and must be positive when entered.

Layers / pallet is read-only: floor((Response max pallet height (mm) - 150) / Height (mm)).
The fixed 150 mm is the pallet base. Zero means no complete layer fits; max pallet heights
at or below 150 mm therefore produce zero. Missing geometry produces blank calculations.
Historical manual counts are retained when no Height has been entered. Clearing
an entered Height clears the derived count; changing the final type or layer count
requires Height to be reconfirmed. Units and net weight per pallet use the derived count.

SQL saves the count and height together under existing ownership, row-version,
approval and audit controls. Calculations use exact decimal/scaled integer math.
Browser and SQL regression suites: `packing-way.spec.ts`, `pallet_layers_contract.py`.
