# Product Mix

Product Mix is optional. Normal Products retain manual net weight and editable Grade versions; they have no Product Mix tab. Mix Products cannot maintain their own Grade versions (enforced in SQL and API). Their Grade tab displays current active child grades, grouped by child Product, for a selected saved mix version. Children without active grades show an explicit empty state. This is a live view, not a historical snapshot. Existing parent Grade records are preserved but cannot be edited while the Product is a mix.

1. Create or edit a Product, select its Customer, and tick **Product Mix**. Save.
2. Open the existing structure (Grade) icon. Use the **Grade / Product Mix** switch.
3. Add child Products and positive unit quantities. Only active normal Products from the same Customer are offered. Self-references, nested mixes and duplicate child Products are rejected.
4. Save a Draft for later, or activate it. Only one version can be Active per Product. Active/Inactive structures are immutable; use New version to copy and revise.
5. Net weight in grams is calculated from the active version: sum(child net weight × unit quantity), rounded once to 2 decimals. Quantities support up to 4 decimals.
6. A new mix has zero net weight and Setup required until its first activation. It cannot be selected for a new Opportunity item until then.
7. Editing a child weight recalculates dependent active mixes and advances their Product RowVersion. This is a live calculation, not a historical weight snapshot. Draft versions do not replace the active weight.
8. Product Mix cannot be disabled after versions exist. A child used in mix versions cannot change Customer or become a mix. Manual calculated-weight edits are rejected by SQL.

Authorization is Product or Admin. Parent, version and child RowVersions protect edits and activation; reload if another user changes a referenced Product.

Deployment: apply migrations through sql/30_product_mix_child_grades.sql to test, deploy the matching API and rebuilt webapp/dist, and restart API workers. No new database is created. Mix versions are maintained in the webapp, not the Excel workbook.
