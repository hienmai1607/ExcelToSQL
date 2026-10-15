# Single and Copy Dim. (migration 106)

Single is the display name of the existing FinalComponent flag; saved IDs and historical records remain compatible. Single types cannot have children and may be assigned directly to materials, including types without a parent.

Copy Dim. is optional and available only for Single types with no parent. Parent Type is locked while Copy Dim. is on. The flags appear as Single, Copy Dim., Shipping. Enabling Copy Dim. does not enable Shipping.

Packaging Pricing has a separate Material dimension definition and Material D1/D2/D3 section for Copy Dim. materials. All named measurements are required and positive. This is separate from Supplier conversion dimensions, which keep their existing meaning.

In the calculator, Copy Dim. permits exactly one material-price record. Final dimensions are copied from its current Packaging Pricing record, and manual definition/measurement entry is disabled. Copied geometry is re-derived on the server for both preview and save. Browser measurements cannot override it.

For a parentless Single type, its material definition is also its final definition. Copy Dim. is not available for child types (migration 107). Dimension names are matched case-insensitively; incompatible or ambiguous names are rejected. Active unit conversions are applied when required. A changed definition requires re-entry in Packaging Pricing. Occupied shipping area is never substituted for material cut-area consumption.

Existing Single types keep Copy Dim. off. Existing prices are not populated automatically; maintain material dimensions before using a newly enabled Copy Dim. type. Existing pricing snapshots are retained.

Deploy the updated app and apply sql/106_packaging_copy_dimensions.sql after 105, followed by sql/107_packaging_copy_dim_root_only.sql, using SQLCMD -b in the application database. The migration sets ANSI_NULLS and QUOTED_IDENTIFIER ON and is repeatable. It adds flags and nullable dimensions without changing existing assignments or prices. Refresh the app after deployment.
