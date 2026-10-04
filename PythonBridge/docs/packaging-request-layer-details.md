# Packaging request layer details

This supersedes the layout described in web-packaging-requirement-sections.md.

Opportunity and Packaging Request editors share Product Info, Packing Way,
horizontal Primary/Secondary/Tertiary requirements, Container and Configuration,
and Palletization. Shelf life appears once in Product Info. Opportunity reads it
from Product Master; Packaging keeps the request-time shelf-life snapshot.

Packing Way uses the existing NumberOfPrimary / NumberOfSecondary storage:
Primary units per Secondary, Secondary units per Tertiary, and final layer = 1.
There is no separate count inside a layer specification.

Each active layer has its own recyclable requirement, recycled content,
metalized/aluminum selection and special comments. Yes/No/NA are the recyclable
and recycled options; Metalized/Aluminum/NA are the metal options. Primary retains
the existing shared column names; Secondary and Tertiary have prefixed columns.
Existing shared values are copied to every existing active layer, preserving
already-populated layer values. A one-time database marker prevents a rerun from
restoring fields users have subsequently cleared. Unchanged historical free-text
values remain valid; new web selections use the dropdowns.

Palletization selects Pallet Master size and Single/Double stacking. The web
height field uses positive integer millimeters, up to 999,999,999.
MaxPalletHeightM remains for existing Excel clients and is kept synchronized with
MaxPalletHeightMM. Floor load clears pallet fields. Mix-child items keep their
parent-only Container/Pallet restrictions.

Product grades are copied into Opportunity-owned JSON snapshots on save.
The Grade icon edits that item copy, never Product Master. New requests freeze
the Opportunity snapshot; if an older item has no captured grade copy, request
creation captures its active Product grades at that time. Existing historical
requests without grade snapshots are not filled from current Master data.
The response Product Info shows the read-only Grade icon left of Nut Density.
Grade names, ratios, material codes and material names are captured, not resolved
from live Master data when displaying a stored snapshot.

Opportunity Edit has a fixed shared pager, page size and profile-save action.
Pages count parent items; expanded mix children stay with their parent.
All drafts remain in memory, copying can use off-page items, and Review & save
validates/saves changed items across all pages. Item layout schema version 5
adds the new editor fields and places shelf life in Product Info.

Deployment: after migrations through 70, run
sql/71_packaging_request_layer_details.sql on the intended database. The script
selects test; verify the intended database before execution. Deploy updated core
files and webapp/dist together, restart the API and refresh the browser.
No deployment is performed by the regression tests: SQL fixtures and schema
changes are rolled back.

Verification:

- tests/python/request_layer_details_contract.py: migration reruns, legacy
  preservation, independent layers, mm/m compatibility, inactive layer clearing,
  frozen request fields, history and frozen grade behavior.
- tests/python/web_item_layout_contract.py: shared version-5 preference catalogs.
- Browser regressions in requirement-sections.spec.ts and packaging-polish.spec.ts:
  layer dropdowns, section ordering, shelf placement, snapshot-only grade editing,
  keyboard-accessible frozen grade view, draft-retaining pagination and themes.
