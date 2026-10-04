# Unit Conversions

Run migrations in order through sql/64_unit_conversion_bidirectional.sql (39 creates conversions; 40 adds nine-decimal precision).
Deploy updated core and complete webapp/dist; restart API and refresh browser.
Unit options come from UoM Master. No business factors are seeded: the only automatically derived factor is the reciprocal of a maintained conversion.

## Maintenance
Open Unit Conversions in the sidebar.
- General: Admin only; applies to all materials.
- Packaging Material: Packaging or Admin; select a material and optionally a vendor.
- Raw Material: RawMaterial or Admin; select a material and optionally a vendor.
- PackagingManager can view general/Packaging conversions, but not maintain them.

1 From UoM = Factor To UoM; factors must be positive, with up to nine decimals.
For example, 1 BOX = 24 EA makes 12 USD/BOX equal to 0.50 USD/EA.
Saving either direction maintains a linked reverse record with factor `1 / Factor`, rounded to nine decimal places. For example, `m2 -> m = 0.265` creates `m -> m2 = 3.773584906`, not another factor of 0.265. Both records retain the same material/vendor scope. The Direction column identifies the automatically generated counterpart.
Only one active record per direction/material/vendor is allowed. Edit either member to update both factors, units, scope and status atomically. Both RowVersions change, so another open editor must refresh. Block either member to disable both; reactivate either member to reactivate both. General conversions remain Admin-only and material-specific maintenance retains its existing role restrictions.
An independent opposite-direction record with a different factor is not overwritten: reconcile or block it first. Matching independent records can be linked without creating duplicates.
The reciprocal must be positive and representable at nine decimals; otherwise saving is rejected without changing either record. Choosing smaller units can avoid a reverse factor that rounds to zero.
Do not define a global BOX conversion unless it truly applies to every material.

## Pricing
For both pricing sections, enable these read-only columns in Layout:
Material Base UoM, Conversion factor, Conversion status,
Base unit price (Vendor currency), Base unit USD price.

Priority: exact material+vendor, then material/all vendors, then general.
Only active conversion records and active From/To units are used.
Reads use direct matching records, including the automatically maintained reverse. There is no multi-step conversion search.
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

## Bidirectional migration

Migration 64 adds linked-record metadata and backfills missing reverses for existing active conversions. Original factors and historical pricing snapshots are preserved. Already matching pairs are linked; blocked records and conflicting or unrepresentable legacy directions are left unchanged, with a warning count in SQL output. The migration can be rerun safely.

Deploy migration 64 and the rebuilt webapp/dist to the VM. No Excel templates, macros or Layout settings change. The SQL save-procedure signature and API request body remain compatible.

Additional verification: tests/python/unit_conversion_bidirectional_contract.py covers reciprocal rounding, edits from either direction, blocking, scopes, stale versions, conflict protection, safe range failures and rerunnable backfill. tests/python/pkg_pricing_contract.py checks that the pricing calculator consumes the generated reverse directly.
