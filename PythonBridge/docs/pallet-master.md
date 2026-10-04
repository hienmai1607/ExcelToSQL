# Pallet Master

Admin and Packaging maintain pallets. PackagingManager can view and export.
Inputs: UoM from UoM Master, positive Width and Length (up to four decimal places).
Pallet size and area are calculated, read-only in the webapp and Excel.

Optional container-capacity fields: **Pallet/20DC**, **Pallet/40DC**,
**Pallet/40HC**, **Pallet/20RC**, and **Pallet/40RHC**. These are manually maintained
whole pallet counts from 0 to 2,147,483,647; blank means not maintained.
They are available in master layouts/sorting, create/edit/view, current-page numeric
exports, and fresh Excel Local Update downloads. Existing saved column layouts are
preserved; enable the new columns in Layout options if they were not previously visible.

Size = Width x Length + UoM code, without trailing decimal zeroes.
Area (mm²) = (Width x mm-per-unit) x (Length x mm-per-unit).
Example: 1.1 x 1.1 M, with M → MM factor 1000, yields 1.1x1.1M and 1,210,000 mm².

Admin must create the necessary UoMs and active general conversion to MM in
Unit Conversions. Nothing is seeded or hard-coded except MM → MM identity.
Only direct general conversions apply; material/vendor-specific conversions
and inferred reverse/chained conversions do not apply to pallet dimensions.
Active saves reject missing conversions. Existing records show Conversion required
if the relevant unit or conversion is later blocked. Areas reflect current factors
on refresh; dimensions are converted with eight decimal places before multiplication.
Duplicate sizes within the same UoM are rejected; edit/reactivate the existing row.

## Deployment

For container capacities, apply **sql/78_pallet_container_capacities.sql** after
the existing migrations through 77. It adds five nullable INT columns, non-negative
constraints, refreshes the master view, and extends the existing batch procedure.
Existing pallet records are unchanged. Omitted counts from older clients preserve
existing values on update; explicit blanks clear them. Restart the API, deploy the
rebuilt webapp/dist, and download a fresh Excel Local Update workbook.
Migration 78 was applied to the local **DESKTOP-5BGMJSC / test** database only.

After SQL 48, run sql/49_pallet_master.sql against the intended VM database
(change USE [test] if your database has a different name).
Then run sql/50_opportunity_pallet_lookup.sql for the Opportunity pallet dropdown.
Deploy the updated core Python files, webapp/dist and
templates/Packaging_Master_Local_Update.xlsm. Restart the API and refresh the browser.
The migration is rerunnable and preserves existing rows. Local test database only
was updated during implementation; the VM is not changed.

Pallet Master supports saved column layouts, filters, sorting, current-page export
and Excel Local Update. Download a fresh Pallet_Master_Local_Update.xlsm from
the section; use UoM codes for Excel entries and refresh after saving to see calculations.
Opportunity Packaging requirements now uses a Pallet size dropdown populated from
active Pallet Master records with active UoMs. Sales can choose pallets without
master-maintenance access. Existing unavailable/legacy values remain visible and
are preserved unless changed; selecting a new value uses the current master choices.
The selected size is stored as text, preserving existing Opportunity and Packaging
Request snapshots. This change does not alter the Excel entry workflow.
