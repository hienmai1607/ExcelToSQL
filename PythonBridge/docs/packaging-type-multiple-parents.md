# Shared Packaging Types: multiple parents

A Packaging Type has one globally unique name and ID, but can be linked to multiple non-Single parents. Edit the existing type (for example Seal) and tick its **Parent Types**. Do not create duplicate Seal records.

- No parents means a standalone/root type. Only root types have layer/Shipping flags.
- Single types cannot be parents. Palletization types cannot be component parents.
- Self-links and cycles are rejected, including indirect cycles through an alternative parent.
- Materials and prices remain attached to the existing component ID.
- Root Single types alone use automatic Copy Dim.; shared child types do not.
- An existing blocked parent link can be retained, but a new blocked parent cannot be assigned.
- Removing a link still used by a child dimension definition is rejected. Remap or retire that definition first; this change does not rewrite historical pricing snapshots.

## Parent-specific dimensions and pricing

A shared child can have separate conversion definitions linked to root dimensions under each parent. The dimension editor lists definitions for every reachable root. Explicit ParentDimensionID and RowVersion select the geometry; the first parent is not used to guess it.

Pricing catalogs walk all active parent links from the selected root. A shared material is offered once, even if it is reachable through two branches. Ancestor definitions and supplier geometry remain available for calculation.

## Excel

Download a fresh local master workbook: **master-5**. Older master-family workbooks are rejected before saving. Other template families are unchanged.

The **Parent Types** cell accepts one existing name, or multiple names separated by semicolons, e.g. `Glass jar - Formed; PET jar`. Dropdowns remain available for single choices. Multiple entries are validated on save. A JSON array of names is also accepted; exports use that form if a name itself contains a semicolon.

Use Action U on the existing Packaging Type row to change its parent links. Blank Parent Types explicitly removes the links; an unchanged cell preserves all existing links.

## Storage and deployment

Apply `sql/128_packaging_type_multiple_parents.sql` after 127, then deploy the API/UI and rebuilt Packaging_Master_Local_Update.xlsm together.

The existing ParentTypeID remains the compatibility first link. Additional links are stored in PackagingTypeParent; v_PackagingTypeEdges combines both. API readers expose ParentTypeIDs. Saves share the existing hierarchy lock, per-row transaction, authorization, uniqueness and optimistic-concurrency rules. Existing IDs, names, first links, material assignments and snapshots are not migrated or merged.

## Verification

Focused coverage: packaging_multiple_parents_contract.py, excel_template_version_contract.py, packaging-type-master.spec.ts, nested-master-create.spec.ts and packaging-dimensions.spec.ts.

Broader pre-existing suites have legacy expectations that are not changed by this feature: parent_geometry_contract.py reapplies an older PackagingOrder constraint incompatible with current Pallet records; packaging_final_component_contract.py has a root-copy price fixture without required material dimensions. pkg-pricing.spec.ts has three stale expectations for supplier formula display, captured-dimension labels and ISO date display (the system now uses configured date formatting).
