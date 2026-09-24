# Packaging Material and Pricing Excel Local Update

Open **Packaging Material** or **Packaging Material Pricing** in the webapp and choose **Excel Local Update**.

Downloads:
- Packaging_Material_Local_Update.xlsm
- Packaging_Pricing_Local_Update.xlsm

Both use one shared VBA engine and preserve the current web layout, column order, filters, sorting and page. Existing Packaging_Template.xlsm is not changed.

## Commands and permissions

On the Master sheet, use:
- C: create a record (or click New record on Controls).
- U: update a record. N/blank also detects changed editable values.
- D: block the record, not physically delete it.

Packaging or Admin access is required to save. PackagingManager retains read-only access. The API and existing SQL procedures recheck authorization and RowVersion; hidden IDs and versions are not permissions.

Controls has Save, Refresh, Filter, Previous, Next and New record. Save uses the shared confirmation dialog and supports up to 500 changed rows. Results and errors appear per row. Successful rows are marked N; failed entries remain for correction. Refresh after Save to load server-normalized values, material names and audit information.

A lost/unknown Save response blocks retry until Refresh and reconciliation. Separate rows can succeed or fail independently.

## Column colors and required fields

- Yellow with *: required and always included in layout/downloads.
- Blue: editable optional inputs and Command.
- Gray / [display]: audit fields, results, hidden metadata and Pricing material name.

Material requires Material code, Material name and Unit of measure.

Pricing requires Material code, Currency code, Price basis, Quantity from, Unit price and Effective from. New Pricing records start Quantity from at zero. Material and Currency codes must match existing master records. Material name in Pricing is display-only.

Optional hidden values are preserved when updating another field. Blank optional numbers/dates stay null. Audit timestamps display UTC+7 with AM/PM; user fields display usernames.

## Pricing dates and amounts

Use YYYY-MM-DD or valid Excel date cells. VBA converts Excel date serials to ISO dates before sending to the API, including the effective-on filter. Do not send raw serial numbers through Swagger/API; those endpoints require date values.

Quantity to and Effective to can remain blank. Existing SQL rules enforce quantity bounds, date ranges, active references and overlapping price periods. Blank is different from zero. Decimal inputs are sent as text to preserve precision; avoid pasting high-precision numbers as Excel numeric cells because Excel has its own precision limit.

## Filters and pagination

Rows per page accepts 1–500.

Both sheets support code/name search, Active/Block status and Created by username. Pricing additionally supports Material code, Currency code and Effective on date. Those three fields do not apply to Material.

Refresh confirms before discarding unsaved changes. The worksheet is unprotected: Excel's manual Hide remains possible, but Save/Refresh restores required columns. Use complete rows when sorting so hidden IDs and original snapshots stay with their records. Do not remove the hidden field-key row or metadata.

## Deployment

Deploy templates/Packaging_Master_Local_Update.xlsm with the updated API and rebuilt webapp/dist. This one base template generates both downloads; runtime generation does not require Excel on the API server.

No new database objects are introduced. Existing Packaging master procedures remain required. EXCEL_API_BASE_URL controls the API address embedded in the workbook where needed.

Workbooks use the Excel user's Windows identity, not the identity of the browser exporter. Development header mode is for trusted testing only. Rebuild and re-sign/reapprove VBA artifacts under company policy:

powershell -File scripts/build_packaging_master_local_template.ps1

Download new files to obtain updated VBA.

Checks:
- tests/python/packaging_master_excel_contract.py
- tests/python/packaging_master_excel_sql_contract.py (local rollback-only fixtures)
- webapp/tests/packaging-master-excel.spec.ts
- scripts/packaging_master_excel_smoke.py and scripts/test_packaging_master_local_template.ps1
