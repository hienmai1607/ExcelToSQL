# Multi-order packaging types and item layers

This webapp workflow supersedes the single-order behavior described in earlier master documentation.
Layout, workbook columns, templates and local-update macros are unchanged.

## Workflow

- A root Packaging Type supports one or more orders: Primary, Secondary, Tertiary.
  Maintain the selected orders using checkboxes. Child components have no Order selector
  and their Order cells are blank. Calculators use the selected root's order and include
  active descendants through the parent hierarchy, regardless of old child Order values.
  Each type keeps its existing ID. Root names must be unique across overlapping orders;
  new child names must be unique within their parent (not globally across orders).
- Each Opportunity item, including mix child items, requests 1, 2 or 3 cumulative layers.
  Primary always appears; Secondary appears at 2+, Tertiary at 3.
  Type requests use active root types supporting that order.
  Copy packaging requirements also copies the requested layer count.
- Creation snapshots the requested layers, type IDs/names, transparency, counts,
  shelf life and existing requirements. Later Opportunity or master edits do not refresh the request.
- Packaging staff confirm the response layer count independently. It defaults to the requested count.
  Only the assigned PIC or Admin can change an unlocked response; existing review permissions remain.
  Each enabled layer has its own type, calculator, calculated MOQ and read-only price per unit.
  Secondary also has Unit / CTN; Tertiary has Secondary units / tertiary.
- Submission/approval requires a type and calculated MOQ for each confirmed layer,
  plus those unit counts for Secondary/Tertiary. Incomplete draft saves remain allowed.
- Reducing layers clears inactive fields on save. Inactive pricing becomes superseded, never deleted;
  historical headers, components, inputs, prices and context remain available.
- New Packaging Material assignments allow only active leaf types, with no children
  (blocked children also make a type a parent). Existing parent/blocked assignments
  remain visible as unavailable and can be retained on unrelated edits or replaced/cleared.

Existing Opportunity items and request snapshots default to two layers.
Confirmed response layers remain nullable until confirmed, meaning use requested layers.
No business types are merged, renamed or seeded; no saved pricing is recalculated by migration.

## Data and API

SQL 66 adds PackagingTypeOrder and v_PackagingTypeWeb. The legacy PackagingOrder
is the first selected order in cumulative order and remains available for old clients.
Unchanged legacy Order updates preserve the selected order set.
Web reads add PackagingOrders arrays and HasChildren metadata.

SQL 68 makes orders root-only. Child PackagingOrders arrays are empty.
The legacy non-null Order column and historical child membership rows are retained
for compatibility, but never determine child calculator eligibility. Existing duplicates,
material links and pricing snapshots are not merged or deleted. New children do not
require an Order; their internal compatibility value is supplied automatically.
New request/response layer choices are active roots supporting that order.
Unchanged historical response selections can still be retained on unrelated edits.

SQL 67 adds PackagingLayerCount to OpportunityItem and RequestedLayerCount/
ResponseLayerCount to PackagingConfigurationRequestItem, plus requested Tertiary
specifications and ThirdPMType/ThirdPMMOQ/UnitsPerTertiary response fields.
Pricing snapshots accept Tertiary; calculated previews include LayerCount.
Snapshots retain requested and confirmed counts and context/version fingerprints.

Both migrations preserve row-version concurrency, per-item authorization, processing
locks, immutable request specifications, draft-price visibility and established auditing.

## Deploy to VM

1. Back up the target database. Pause API writes during migration/deployment.
2. After migrations through 65, run sql/66_packaging_type_orders.sql, then
   sql/67_packaging_layers.sql, then sql/68_packaging_child_components.sql,
   selecting the correct database in each USE statement.
3. Deploy updated core files: main.py, packaging_orders.py, packaging_type_api.py,
   packaging_master_api.py, packaging_fields.py, packaging_api.py, pkg_pricing.py,
   pkg_pricing_api.py, opportunity_views.py and request_views.py.
   Deploy the complete matching webapp/dist folder, not just index.html.
4. Restart the API and hard-refresh the browser. Verify all three type checkboxes,
   requested/confirmed layer selectors, Tertiary calculator and leaf material choices.
   Selecting a Parent Type must hide Order; child rows must have blank Order cells.

No Excel/Layout/template deployment is needed for this change.
Only the local test database was migrated during implementation; the VM was not changed.

## Verification

Rollback-only tests in tests/python/packaging_layers_contract.py cover multi-order
reads/edits, legacy preservation, duplicate detection, permissions, requested snapshots,
processing locks, layer clearing, Tertiary saves/read-only prices/history and submission.
Existing calculator tests verify context/version fingerprint invalidation and atomic saves.
tests/python/packaging_child_components_contract.py verifies orderless create/edit,
root-only validation, child name scoping, unchanged historical selections, all three
root orders using the same descendants, and migration snapshot/link preservation.
Browser tests cover the selectors, conditional sections, leaf-only dropdown, calculated
Tertiary values and payloads. Default desktop viewport remains 1920x1080.
