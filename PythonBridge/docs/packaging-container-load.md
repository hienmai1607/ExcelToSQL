# Container loading in Packaging Response

Webapp only: Layout settings, Excel templates and local-update macros are unchanged.

## Sections and calculations

Sections follow the immutable request's Configuration request snapshot:

- Pallet load: show Pallet load.
- Floor load: show Floor load.
- Both: show both sections.
- Blank or legacy unrecognized instructions: retain the pallet-load section; floor fields
  appear only for Floor load or Both.

Pallet load has two optional user-entered positive whole-number counts:

- Layer / Container: LayersPerContainer.
- Pallet / Container: PalletsPerContainer.

Read-only totals:

- Carton / Container = Cartons / layer (Palletization) x Layer / Container.
- Net weight / Container (kg) = Net weight per pallet (kg) x Pallet / Container.

These are independent inputs and formulas. Layer / Container is the total number of
carton layers in the container, not Layers / pallet and not packaging-layer count.

Floor load has one optional user-entered count, Carton / Container Floor
(CartonsPerContainerFloor). Net weight / Container Floor (kg) is read-only:
final confirmed packaging-layer net weight (g) x Carton / Container Floor / 1000.
The final layer can be Primary, Secondary or Tertiary, as defined in Packing Way.

For 10 g product weight, 10 x 5 x 1 packing, 10 cartons / layer and 5 layers / pallet:
carton net weight is 500 g and pallet net weight is 25 kg.
100 layers / container gives 1,000 cartons; 20 pallets / container gives 500 kg.
1,200 floor-loaded cartons gives 600 kg.

## Storage and assurance

Migration 70 adds three nullable INT input columns with positive-count constraints.
Drafts can leave counts blank. API, browser and direct SQL validate positive whole
numbers up to 2,147,483,647. Non-null counts for the wrong request configuration
are rejected by SQL, and hidden fields are excluded from web save payloads.

Totals are derived from saved counts and the immutable request product weight,
using Python Decimal and browser BigInt arithmetic. Missing inputs yield blank
totals, not guesses. Layer count or Packing Way changes recalculate totals.
Approved/locked responses remain read-only. Count and derived outputs follow the
existing response visibility rules; Opportunity users see draft values masked.

The legacy CartonsPerContainer database column is preserved for older records and
Excel compatibility. It is no longer an editable web input and is not overwritten.
The new API output CalculatedCartonsPerContainer is an exact integer string,
including results beyond the SQL INT or JavaScript safe-integer range.
Other derived API outputs are NetWeightPerContainerKG and
NetWeightPerContainerFloorKG; neither is accepted as a response input.

New counts use the existing response transaction, PIC/Admin authorization,
row-version checks and response change log. The migration does not rewrite
business rows, request specifications or pricing snapshots.

## Deployment

After migrations through 69, run sql/70_packaging_container_load.sql on the intended
database, then deploy the matching core/packing_way.py, core/packaging_fields.py,
core/request_views.py and built webapp/dist. Restart the API and hard-refresh the
browser. No VM change was performed during development.

Verify Pallet load, Floor load and Both; packing changes; save/reload; read-only
approved items; existing legacy entries; and the standard 1920x1080 display.

Contracts: tests/python/container_load_contract.py and
webapp/tests/container-load.spec.ts.
