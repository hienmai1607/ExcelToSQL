# Vendor Master

Vendor Master contains Vendor name (required and unique), Address (optional), and Status (Active or Block). Audit fields and RowVersion follow the other Packaging masters.

Admin and Packaging users can create and update Vendors. PackagingManager users have read-only access. Delete commands block the Vendor instead of deleting referenced records.

Use **Vendors** in the webapp navigation. The shared master interface supports layouts, filters, sorting, export and Excel Local Update.

## Packaging Material Pricing

Vendor is optional. Existing prices retain a blank Vendor. Select an active Vendor when entering a price; a blocked Vendor already assigned to a price can remain unchanged.

Overlap validation applies within the same material, currency, price basis and Vendor. Different Vendors may quote the same quantity range and dates. Prices without a Vendor form their own overlap group.

An omitted Vendor field on an API update preserves the existing assignment; an explicit null clears it. Excel uses the unique Vendor name and validates it on save.

## Deployment

Apply sql/32_vendor_master.sql to the existing test database after prior migrations. It creates Vendor, its batch type/procedure, the nullable PackagingPrice.VendorID relationship, and the versioned pricing batch procedure. The old pricing procedure remains compatible and preserves existing Vendor assignments.

Deploy the updated API, webapp/dist and templates/Packaging_Master_Local_Update.xlsm together. Restart the API and download a fresh Excel Local Update workbook to include the Vendor field.

## Currency and USD pricing

Apply sql/33_vendor_currency_pricing.sql after migration 32. Vendor Currency is optional for backward compatibility and defaults the currency when selecting a Vendor for a price.

Pricing uses its existing CurrencyID and UnitPrice as **Vendor currency** and **Unit price (Vendor currency)**. They are snapshots, not live links to the Vendor default. Exchange rate (Vendor currency per USD) supports 10 decimal places: 1 USD = X vendor currency units. SQL calculates read-only Unit USD price as UnitPrice divided by ExchangeRateToUSD, with 8 decimal places. USD prices use rate 1 on save.

Existing records are not assigned guessed rates. Without a rate, the converted price is blank. Previous clients retain their batch interfaces and preserve existing rates when the currency is unchanged. Download a fresh Excel workbook to edit rates and view converted prices. Add the new columns through Layout if an existing saved layout hides them.

Apply sql/35_pricing_vendor_currency_per_usd.sql after migration 34 for the division convention. Review existing rates before company rollout: values entered using the old USD-per-unit convention need an explicit reciprocal conversion; values already entered as vendor currency per USD must stay unchanged. The migration does not rewrite stored rates. Internal API field ExchangeRateToUSD is retained for compatibility; its convention is now vendor currency per USD. Refresh or download a fresh workbook so the label matches.
