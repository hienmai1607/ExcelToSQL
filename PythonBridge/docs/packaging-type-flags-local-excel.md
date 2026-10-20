# Packaging Type flags and local Excel templates

Apply `sql/124_packaging_type_mix_flags.sql` after migrations through 123 before deploying this code. It is transactional and repeatable. It has been applied to the local desktop test database, not a VM.

## Packaging Types

- Primary / Secondary / Tertiary apply to standalone products and Mix child units.
- Primary Mix / Secondary Mix / Tertiary Mix independently enable the corresponding layer for Mix parents.
- Shipping, Palletization and Single form the final checkbox row. Palletization retains its exclusive-layer rules.
- Copy Dim. is no longer separately editable: only a root Single type copies dimensions automatically. Single child components do not.
- Existing roots with Secondary or Tertiary retain their previous eligibility for all three Mix layers during migration. Saved response/loading snapshots are not rewritten.

## Local Excel

Re-download local templates after deployment; do not reuse old Order/Copy Dim. templates.

### Compatibility and Action columns

Visible workbook headers use **Action**, with C (create) and U (update); Packaging Request responses allow U only. Hidden technical keys remain stable.

The API checks a family-specific template version before entering any Excel save handler. Missing, outdated, future or wrong-family versions are rejected with a download-fresh-template message. Changing a workbook title or refreshing its data does not upgrade its template.

Current versions are maintained centrally in `core/excel_template_version.py`: master-3, product-2, opportunity-4, request-2. When a workbook contract changes, bump that family, update its VBA version check, rebuild the binary template and run the compatibility tests. Keep the previous workbook as a backup; reapply unsaved changes to a fresh template rather than copying hidden metadata.

### Globally unique Packaging Type names

Apply `sql/125_packaging_type_unique_name.sql` after 124. It qualifies existing duplicate child names with their parent name, preserving IDs and foreign keys. Standalone names remain unchanged when the child rename resolves the collision. Case and surrounding spaces do not create distinct names; blocked names also remain reserved. The database unique index protects web, Excel and direct SQL writes. The migration refreshes wildcard-view metadata before updating names so dimension triggers keep reading the correct root IDs. Existing saved snapshots are not rewritten.


Packaging Types export separate boolean columns for all layer flags plus Shipping and Single. Status is a separate editable column for masters. Commands are C/U; blank means unchanged. Packaging Request workbooks support U only because requests cannot be created through that response-update interface. Transaction workflow statuses remain display-only and must be changed using the existing workflow actions.

Dropdowns cover applicable editable fixed choices and authorized current lookup data. Download and page refresh update lookup choices. Excel choices are a convenience, not an authorization boundary: server-side permission, hierarchy, workflow, references and row-version validation remain authoritative.

Master, Product, Opportunity and Packaging Request templates include the shared refresh module. Rebuilding templates requires desktop Excel; serving and generating downloads does not. Existing template backups remain in `templates/backups`.

## Verification

- `python tests/python/packaging_flags_excel_contract.py`: rolled-back SQL fixtures, flag derivation, stale versions, migration repeatability, lookup authorization and workbook package contracts.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_local_dropdown_flags.ps1`: isolated synthetic workbooks in desktop Excel; opens all four adapters without repair and runs dropdown refresh macros. No registry or global Excel security settings change.
- `npx playwright test tests/packaging-type-master.spec.ts tests/nested-master-create.spec.ts` from webapp: layout, selection, role, nested master and profile regressions.
