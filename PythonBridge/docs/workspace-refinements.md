# Workspace compact-entry refinements

Desktop list headings and their task icons share a row. At narrow widths they
wrap normally. Navigation/list labels are Packaging Pricing, Raw Pricing and
Loss Master; internal route/entity names are unchanged.

There is one downward-download icon labeled Excel local template:
- Existing editable master workbook endpoints are used only when canWrite is
  true and a local workbook adapter exists.
- Otherwise the existing read-only .xlsx current-view export is downloaded.
- Customer and shared-master pages currently have only the read-only adapter.
- Opportunity and Packaging Request workbook downloads keep their existing
  server-controlled edit permissions. No authorization is broadened.

At desktop widths of at least 1400px, Opportunity header controls share one row.
Currency is derived from the customer. Rate labels are shortened but retain
their full accessible labels and help. Bid date controls remain compact.
Summary counts occupy a small non-input row.

Estimated awarded units is a read-only live display:
Annual units * Estimated award percent / 100. Empty inputs stay empty; zero is
valid. The derived display is not included in save payloads. Shelf price shows
the selected customer currency while its saved meaning is unchanged.

Opening Packaging requirements or Shipment details smoothly reveals that
section's end inside the normal dialog scroll containers. Closing does not
scroll. Expanded Mix children reveal the last child. Reduced-motion preference
uses an immediate scroll instead.

Opening Opportunity Items view reveals the end of the item panel. Checking an
eligible packaging item reveals the request form; unchecking does not scroll.
Request notes and Response due controls share a 40px height. Notes still accept
multiline text and retain the existing maximum length.

All Customer, packaging/raw master and shared-master batch Add section actions
reveal the new section and its Add button after rendering. Normal edits and initial loads do
not trigger a reveal. Sections reserve space below for sticky save actions.
These reveals also respect reduced-motion preferences.

Requested packaging layer count is inline in the read-only request. Layer
symbols align right with request quantities and response pricing labels.
Primary transparency omits the redundant Primary prefix. Response quantity,
weight and price labels remain single-line with narrow-screen layout fallback.

## Packing and master-editor polish

Response quantities and layer net weights use compact desktop columns.
Captured dimensions receive the remaining width and wrap between measurements
when needed, rather than crossing into the next packaging section. Three-layer
layouts stack at narrower desktop widths; mobile layouts remain responsive.

Batch Add section actions reveal the Add button after the new record renders,
with space reserved for sticky Save actions. Customer/master editor titles and
Close buttons remain attached to their dialog while the contents scroll.

Packaging Type Shipping and Final component flags use checkbox-first inline
labels, matching the order choices. Parent Type cells and the Parent Type
selector display the type name without a redundant Primary/Secondary/Tertiary
prefix. Stored relationships and order assignments are unchanged.

Add is beside the ID header in Dimensions, Unit Conversions and Administrator
masters, matching the existing Customer/packaging/raw/shared master grids.
Dimensions no longer have a per-row test shortcut. Open Edit or View and expand
Test Calculation to preview formulas without changing saved values.

The sidebar and request list title are labeled Packaging Requests.

### Verification scope

Focused browser checks cover packing bounds at desktop/mobile widths, fixed
editor Close, new-section plus Add visibility, checkbox alignment, ID-header
Add placement, and Edit/View formula previews. The Parent Type read/sort/Excel
normalization contract and focused master/API permission checks also pass.

The full older packaging_type_master_contract.py and
packaging_dimension_contract.py suites are not clean: they still exercise
retired Packaging Type PriceBasis fields and legacy dimension fixtures/workflow.
Their business-model updates are outside this UI polish. No pricing,
formula-calculation or dimension-save rules were changed by this polish.
