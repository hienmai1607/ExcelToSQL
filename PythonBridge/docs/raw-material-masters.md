# Raw Material and Raw Material Pricing

The new sections use separate dbo.RawMaterial and dbo.RawMaterialPrice tables.
They follow Packaging Material and Pricing, sharing Vendor, Currency and UoM
lookups, but never using Packaging Material records as raw-price references.

- RawMaterial scope can read/create/edit/block both new masters. Admin has full access.
- Packaging and PackagingManager alone do not grant Raw Material access.
- Vendor and UoM maintenance permissions are unchanged; RawMaterial receives lookup access only.
- Codes are generated as RAW-0000000001. D blocks rather than deletes.
- Prices include optional Vendor, Vendor currency (defaulted from Vendor),
  Price UoM, quantity ranges, effective dates, status, vendor unit price and exchange rate.
- Exchange rate means vendor currency per USD. Unit USD price = unit price / rate;
  USD uses rate 1. A missing non-USD rate leaves USD price blank.
- Active prices cannot overlap for the same material, vendor, currency and Price UoM
  across both dates and quantity ranges. Edits require current RowVersion.
- Layouts, widths, filters, numeric formatting, XLSX exports and Excel Local Update
  follow the existing master screens. Exports keep numeric values without currency suffixes.

Since migration 45, Raw Material has an optional Grade field. Only active
leaf grades appear as valid selections. The old assignment on Raw Grade is
backfilled to Raw Material; Product Grade Raw Pricing follows the new link.
Excel Local Update also permits editing Grade by name, but rejects ambiguous
names (use the web form for those grades). Apply migration 45 after 44 before
deploying the corresponding core and webapp/dist.

## Update an existing VM through migration 37

1. Back up the database using your normal process.
2. Run sql/38_raw_material_masters.sql against the existing test database after 37.
   The script is rerunnable and does not populate or convert existing business records.
3. Copy the updated core folder, complete webapp/dist folder and
   templates/Packaging_Master_Local_Update.xlsm. Preserve VM settings, venv and attachments.
4. Restart the API; hard-refresh the browser. Download a fresh Excel workbook for new masters.
5. Assign Scope = RawMaterial to the intended users using Admin User Access maintenance.
   No users are granted the role automatically. Admin can use the sections immediately.

The legacy fresh-database deployment manifest is not the update path for this release.
No Node installation is needed on the VM when deploying the built dist folder.

## Verification

- tests/python/raw_material_contract.py: permissions, isolated routes/lookups, layouts and workbook construction.
- tests/python/raw_material_sql_contract.py: migration rerun, lifecycle, overlap/concurrency,
  USD conversion, Vendor currency and live SQL role revocation; all DB changes roll back.
- webapp/tests/masters.spec.ts: shared master regression coverage and Raw Material browser workflows.
