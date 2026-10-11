# Response weight, Container Load and density defaults

Requires migration 101 after migrations through 100, plus matching core code and rebuilt webapp/dist. Back up the intended database and pause API writes before applying SQL; restart the API and refresh the browser after deployment.

## Applicable Net weight

Applicable Net weight (g) defaults to the immutable request's Product weight. Standalone and Mix child responses can edit it independently. A Mix parent's value is read-only: sum of each child's applicable weight multiplied by its captured mix quantity.

Response packing weights, used volume, carton/pallet/container net weights and efficiency use applicable weight. The original Product weight and request snapshot stay unchanged. Missing child data leaves dependent Mix results blank. Saved overrides retain response authorization, stage, row-version and audit checks.

The field is available as a display column in layouts and layout-aware Excel exports. It is edited in the response screen, not through the existing legacy Excel update contract.

## Container Load

One section replaces the separate Pallet load and Floor load sections.

- Pallet loading: show Pallet / Container. Carton / Container is calculated as Pallet / Container x Layers / pallet x Cartons / layer.
- Floor loading and Both: hide Pallet / Container; Carton / Container is a required, positive, manually entered whole number.
- Net weight / Container (kg) uses the final packaging-layer applicable net weight and the unified carton count.
- Per-container profiles retain their own manual entries when switching container types.
- Layer / Container and separate Floor count/weight fields are removed from the screen and layout catalog. Historical database fields are retained for compatibility.
- Both has one response result. TCB Analysis for Both remains deferred, as previously requested.

## Nuts-grade density defaults

dbo.NutGradeDensity matches the frozen combination of exact grade, nut type and final proportion. Product ID, Product weight, vendor and display order do not affect matching. Incomplete grade trees have no shared default.

A new matching response with blank density proposes the recorded default. Existing response densities are not overwritten. Saving a positive density for a new combination creates its mapping automatically.

If response density differs from an existing default, the refresh icon beside density lets the user stage an overwrite. The shared default changes only on Confirm save. A normal response edit never overwrites it. Updates are audited in dbo.NutGradeDensityHistory and protected by the default's row version; stale updates reject the entire response save.

Only authorized response roles receive shared-default suggestions. Approved/locked responses cannot update them. New defaults do not retroactively change saved responses.

Regression coverage: tests/python/response_weight_density_contract.py and webapp/tests/container-load.spec.ts.
