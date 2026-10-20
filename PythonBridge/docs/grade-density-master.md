# Grade Density Master

Apply sql/121_grade_density_master.sql after migrations through 120, then deploy/restart the matching API and web build. Migration 121 permits an audited manual default change without fabricating a source response item. It preserves all existing history.

The master uses the existing NutGradeDensity table. Packaging editors maintain defaults; Packaging Managers have read-only access. Role-based access can be assigned through the Grade Density Master workspace page.

Create defaults by selecting complete combinations from active non-Mix Product grade versions or captured non-Mix Packaging Request grades. Nut/grade lineage and exact proportions determine identity, using the existing matching rules. Existing combinations cannot be renamed or redefined; only density changes. Duplicate defaults are rejected.

Edits use row-version checks, positive six-decimal density validation, transactional writes and NutGradeDensityHistory. Existing responses retain their explicit saved densities; future default lookup uses the updated value. There is no deletion or retroactive mass update.

The UI shares master search, sorting, layout/profile settings, pagination, XLSX export, stacked create sections, review/save confirmation and read-only close behavior.

Legacy import clearance values remain stored and retain their original calculation basis; only their explanatory note is hidden.
