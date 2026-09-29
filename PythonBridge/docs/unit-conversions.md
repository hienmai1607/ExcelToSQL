# Unit Conversions

Run sql/39_unit_conversion.sql after 38, then sql/40_unit_conversion_precision.sql in the existing test database.
Deploy updated core and complete webapp/dist; restart API and refresh browser.
No conversion factors are seeded or inferred. Unit options come from UoM Master.

## Maintenance
Open Unit Conversions in the sidebar.
- General: Admin only; applies to all materials.
- Packaging Material: Packaging or Admin; select a material and optionally a vendor.
- Raw Material: RawMaterial or Admin; select a material and optionally a vendor.
- PackagingManager can view general/Packaging conversions, but not maintain them.

1 From UoM = Factor To UoM; factors must be positive, with up to nine decimals.
For example, 1 BOX = 24 EA makes 12 USD/BOX equal to 0.50 USD/EA.
Only one active record per direction/material/vendor is allowed.
Block a conversion to remove it from matching; records retain audit fields and RowVersion.
Do not define a global BOX conversion unless it truly applies to every material.

## Pricing
For both pricing sections, enable these read-only columns in Layout:
Material Base UoM, Conversion factor, Conversion status,
Base unit price (Vendor currency), Base unit USD price.

Priority: exact material+vendor, then material/all vendors, then general.
Only active conversion records and active From/To units are used.
There is no reverse or multi-step search: maintain the required direction.
Identical Price and Base UoM need no conversion and use factor 1.
Different units with no match show Conversion required and blank converted prices.
Vendor UnitPrice, Price UoM, exchange rate, original UnitUSDPrice and quantity bands
are not modified. Quantity bands remain in Price UoM.

Base-unit prices divide the original price by the selected conversion factor.
These are live comparison values: editing/blocking a factor or changing material
Base UoM affects subsequent reads, not stored historical snapshots.
XLSX/Excel Local Update include selected calculated columns as read-only numeric
values without currency suffixes; conversion master maintenance is in the webapp.

Verification: tests/python/unit_conversion_sql_contract.py uses rollback-only
local SQL transactions; webapp/tests/unit-conversions.spec.ts covers role-based entry.
