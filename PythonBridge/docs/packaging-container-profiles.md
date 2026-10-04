# Container loading profiles

Migrations: `sql/83_packaging_container_profiles.sql` (after migration 82),
then `sql/84_packaging_container_layers.sql` and
`sql/85_packaging_container_shipping_height.sql`.

Container request selects the family: Dry offers 20DC/40DC/40HC, Reefer offers
20RC/40RHC, and Both offers all five. A shared response selector controls both
Pallet load and Floor load. Related item views also expose Container type.

Each response item retains independent Pallet / Container and Carton / Container
Floor values for every used container type. Switching
does not discard the previous type. Partial saves preserve unspecified types
and counts; explicit null clears a count.

Pallet / Container is read-only. It is captured from the corresponding Pallet
Master column when a type is first used, or when the response pallet size changes.
Unrelated edits do not refresh existing capacity snapshots. A missing master
capacity leaves the calculation blank; a capacity of zero produces a zero total.

Calculated fields are read-only and recomputed for each saved profile:

- Layer / Container = ROUNDDOWN(clearance / Shipping height (mm), 0).
  Clearance is 2070 mm for 20RC and 2090 mm for every other type.
- Carton / Container = Pallet / Container × Cartons / layer × Layer / Container.
- Net weight / Container (kg) = Carton / Container × last-layer net weight (g) / 1000.
- Net weight / Container Floor (kg) = Carton / Container Floor × last-layer net weight (g) / 1000.

Layers / pallet determines Pallet height, but neither value affects Layer / Container.
Layer / Container uses the last packaging layer's Shipping height. Missing or
invalid Shipping height leaves the calculation blank; height above the clearance
gives zero container layers. Max pallet height may be blank without affecting it.
Last-layer weights use the request's captured product weight and response packing
relationships, not the current Product Master.

Legacy scalar values are not automatically assigned to an arbitrary type. The
first explicit selection carries the legacy floor count into that type only,
replaces the legacy pallet count with its Pallet Master mapping, and calculates
Layer / Container from geometry. Other types start with blank editable floor counts.
Choose a container type before editing loading counts in the web editor.

The migration adds no request records and rewrites no existing history.
Profile changes use the existing response transaction, row-version checks,
PIC/stage permissions, draft visibility rules, and response audit trail.
The stored profile inputs are the source of truth; derived totals for every type
are returned as `ContainerLoadResults` rather than editable duplicate totals.

Verification:
`python -m unittest container_profiles_contract container_load_contract`
and `npx playwright test container-load.spec.ts`.
