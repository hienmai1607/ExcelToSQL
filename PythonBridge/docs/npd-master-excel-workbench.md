# Ingredients Master and Ingredient Pricing Excel Local Update

Open **Ingredients Master** or **Ingredient Pricing** in the NPD workspace and choose the **Excel local template** icon.

Downloads:
- Ingredients_Master_Local_Update.xlsm
- Ingredient_Pricing_Local_Update.xlsm

Users with edit access receive the macro workbook. Users with display-only access keep the static current-view `.xlsx` export. The workbook preserves the current web column order, sort, search/status filters and page. Ingredients always shows Ingredient code as the first column.

Both files use the shared master workbook engine (templates/Packaging_Master_Local_Update.xlsm, module modPackagingMasterLocal) and its Controls sheet: Save, Refresh, Filter, Previous, Next and New record. Commands, colors, retry protection and the 500-row limit match [Packaging Material and Pricing](packaging-master-excel-workbench.md).

## Fields

| Workbook | Required (*) | Optional editable | Display only |
| --- | --- | --- | --- |
| Ingredients | Description, Base UoM | Grade/ type/ nature, Origin, Status | Ingredient code (generated on save), audit fields |
| Ingredient Pricing | Ingredient code, Vendor, Price, Currency, Price unit, Quantity from, Effective from | Quantity to, Effective to, Currency units per USD, Status | Ingredient description, Ingredient base UoM, audit fields |

- Base UoM and Price unit dropdowns list only active Weight/Mass units, as the web editor requires.
- Ingredient code, Vendor and Currency must match existing master records. Pricing requires an active ingredient and vendor.
- Quantities are in the ingredient base UoM. Quantity to is exclusive. Blank optional values remain null. Decimals are sent as text, so stored precision is kept.
- Dates use YYYY-MM-DD or real Excel date cells. Bare date serials are rejected at the API.
- Use Status = Block to block a record. There is no physical delete.
- Additional Controls filters: Created by (both); Ingredient code, Currency code and Effective on (Pricing only).

## Rules and permissions

Save checks NPD edit access for the page (`ingredients` / `ingredient-prices`). It then calls the same NPD save functions as the web editor, so the NPD workspace lock, RowVersion checks, NPDAudit snapshots, the fixed Base UoM once pricing exists, and same-vendor overlap blocking all apply unchanged. Each row succeeds or fails independently, and messages are reported per row.

## Deployment

No SQL migration is required (NPD migrations 154–157 must already exist). Deploy `core` (new npd_master_excel.py plus the updated packaging_master_excel_api.py), the rebuilt templates/Packaging_Master_Local_Update.xlsm and `webapp/dist`, then restart the API. The template version stays `master-5`. Existing Packaging master workbooks keep working, but download fresh files to get the updated VBA.

Rebuild and re-sign the template under company VBA policy:

    powershell -File scripts/build_packaging_master_local_template.ps1

Checks:
- tests/python/npd_master_excel_contract.py
- webapp/tests/npd-master-excel.spec.ts
- scripts/test_packaging_master_local_template.ps1 -WorkbookPath <downloaded ingredient workbook> (read-only Refresh/New record VBA check)
