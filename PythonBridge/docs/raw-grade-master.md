# Raw Grade Master

## Current assignment model (migration 45)

Raw Grade Master maintains Grade name, optional Parent grade and Status only.
Raw Material Master owns the optional Grade selection. A Raw Material may select
only an active leaf grade (one with no children); multiple materials may select
the same leaf grade. A grade assigned to a material cannot later become a parent
until its materials are reassigned. Raw Pricing now finds materials through
`RawMaterial.GradeID`, and Product Grade still selects grades by ID.

Migration `sql/45_raw_material_grade_assignment.sql` runs after 44. It
backfills existing links and retires the old Raw Grade material assignment.
It stops with a clear error if a material had multiple grades or a linked
grade has children; resolve those records before applying it on the VM.
The backfill changes Raw Material RowVersions, so refresh open editors and
download fresh Excel Local Update workbooks after deployment. Deploy core,
complete webapp/dist and the updated workbook adapter together, then restart
the API. The old material-on-grade SQL tests are skipped; the new
`tests/python/raw_material_grade_assignment_sql_contract.py` suite covers
the current assignment flow. The sections below document earlier migrations and are superseded
where they describe material assignment on Raw Grade.

## Product Grade child Raw Material (migration 46)

Child nodes in the Product Grade tree may select one active Raw Material
assigned to their selected Raw Grade. The choice is optional and stored on
the Product Grade version item; changing the grade clears the choice. Root
nodes cannot select a material. Read-only versions show the saved choice.
Raw Pricing displays only the chosen material's current price tiers. For
older items without a choice, it continues to show all materials currently
assigned to that grade. SQL validates the grade-material relationship on
every new save.

Run `sql/46_product_grade_raw_material.sql` after 45 on the VM, then deploy
the updated core and complete webapp/dist together. Migration 46 was applied
and rerun successfully on the local test database; the VM is not updated.

Each Raw Grade optionally belongs to one Raw Material. RawMaterial users and Admin can
maintain Grade name, Raw Material and Active/Block status in Raw Grade Master.
The same grade name may be used for different materials; duplicate names within
one material are rejected. Layouts, filtering, sorting and current-page XLSX
export use the shared master screen. Excel Local Update is not offered for this master.

Product users select `Grade - Raw Material code - Raw Material name` in the
Product Grade tree, including the initial grade tree when creating a Product.
Active unassigned group grades and active grades linked to active materials are selectable. Every saved tree
item must have a valid RawGradeID, and SQL snapshots the authoritative grade name.
Ratios, nested levels, version activation and Product Mix restrictions are unchanged.

Existing historical grade labels are not automatically mapped or rewritten.
Active/Inactive versions remain read-only. When revising legacy grades, select
their Raw Grade records explicitly before saving. Blocked or unavailable choices
must also be reselected. Renaming a master does not rewrite saved grade labels.
A Raw Grade used by any Product version cannot move to another Raw Material;
create a new master record instead. Blocking does not delete history.

## Deployment

Run sql/41_raw_grade_master.sql after migration 40 against the existing database.
Deploy updated core and complete webapp/dist, then restart the API and refresh
the browser. Migration 41 has been applied to the local test database; VM rollout
remains manual. No master records or legacy mappings are seeded.

## Tests

- tests/python/raw_grade_sql_contract.py: rollback-only SQL/API integration.
- webapp/tests/masters.spec.ts: master creation and relationship payload.
- webapp/tests/product-grades.spec.ts: dropdown tree entry and version workflows.
- webapp/tests/product-mix.spec.ts: unchanged read-only child-grade views.

## Parent Grade

Migration 42 adds an optional Parent Grade dropdown. Leave it blank for a root
grade. Parents can be from any Raw Material; labels include the material code.
Only active parents may be newly selected; any assigned material must also be active. Existing blocked
parents can be retained or cleared. Self-parenting and ancestor cycles are rejected.
The field organizes Raw Grade Master. Migration 44 also restricts Product Grade
child selections to direct master children; saved historical trees and ratios are unchanged. Parent grade and Parent Raw Material are available in Layout.
Run sql/42_raw_grade_parent.sql after 41 on the VM, then update core and webapp/dist.

## Material assign

Migration 43 adds the Material assign checkbox, derived from the material link.
Tick it to enable the required Raw Material dropdown. Leave it unticked for a
group grade; unticking clears the material link. Existing linked grades remain
ticked. Group grades can be parents and Product Grade tree selections.
A grade used by any Product version cannot have its assignment added, removed
or changed. Create a new grade instead. Names remain unique within each material;
unassigned grades also cannot share the same name.

Run sql/43_raw_grade_material_assign.sql after 42, then deploy core and webapp/dist.
Migration 43 has been applied locally; VM deployment remains manual.

## Product Grade child choices

Run sql/44_product_grade_parent_validation.sql after 43. Deploy core and
webapp/dist together and restart the API so the lookup includes ParentGradeID.
Product Grade children must directly belong to their selected parent in Raw
Grade Master. Root choices remain unrestricted among active selectable grades.
Existing incompatible draft children must be reselected before saving; historical
read-only versions are not rewritten. SQL enforces the same rule for every save.

## Raw Pricing view

Product Grade offers Tree and read-only Raw Pricing views. Raw Pricing reads the
materials linked to grades in the selected version (or unsaved draft) using
Product/Admin read access, without granting Raw Material maintenance access.
It shows every active price effective on the current UTC date, inclusive of both
effective dates, for active grades/materials and active vendors (or no vendor).
Quantity tiers are displayed in Price UoM; no vendor or tier is silently selected.
USD prices and base-unit conversion follow Raw Material Pricing Master and Unit
Conversion. Missing assignments, prices, rates and conversions are identified,
not replaced with zero. Values are current master data, not historical snapshots
or a ratio-weighted Product cost. Switching views preserves draft changes.
Refresh prices reloads the master data.

No additional SQL migration is required for this view. Deploy core and the complete
webapp/dist, restart the API, and refresh the browser.

Raw Pricing displays only material-assigned grades; unassigned grouping grades are omitted.
Tree and Raw Pricing controls sit together, and Refresh prices uses an accessible refresh icon.
