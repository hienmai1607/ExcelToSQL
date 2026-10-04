# Packaging Pricing Calculator

Current pricing uses [Packaging formula roles](packaging-formula-roles.md),
migration 80: N × child Convert from parent × vendor price / child Convert from
supplier. Parent occupied formulas only supply shipping efficiency. Child
formulas do not inherit occupied area or volume. Supplier measurements remain
on Packaging Material Pricing; ordinary Count conversions, MOQ, currency handling
and immutable history remain. Earlier inheritance notes below are historical.

The calculator icon beside Primary Type and Secondary Type opens current active materials assigned to active descendant Packaging Types. Directly assigned materials on the selected parent type are not components. Each effective vendor/quantity-tier price is shown separately; materials without effective prices remain visible but cannot be selected. Volume-basis materials are shown but cannot be calculated yet.

Enter the number of each material used per one packaging unit. Count quantities must be whole numbers. Optional dimension measurements use an active definition for the material's type or an ancestor. Square meter materials require a reviewed Square meter definition, its formula measurements, and a square-meter UoM. Formula inputs use their displayed units directly; the formula itself must produce m², as in Dimension Master's Test Calculation. No conversion of measurements is silently applied.

When exactly one applicable dimension definition exists, it is selected automatically and displayed read-only. Measurements remain editable. With multiple definitions, a dropdown remains available; Count materials with no definition do not show an empty optional selector.

Selected components show their **Previous calculated price**, quantity and product MOQ from the most recent matching saved setup, with its snapshot ID and save date. A loaded reference retains the source component values for comparison, even when its current vendor price has changed. Reopening a pending applied calculation shows its last applied component values explicitly labeled as not saved yet. These values are historical comparisons, not a current quote; new calculations appear separately and require Calculate → Apply before saving.

The material list and selected lines display the price's **Effective date** range (`EffectiveFrom` through `EffectiveTo`, inclusive); a missing end date is shown as Open-ended. These are read-only Pricing Master dates, not a new user-entered quote date.

Selecting a Square meter material shows its applicable price-UoM-to-square-meter conversion in both directions, such as `1 m = 3.773584906 m2` and `1 m2 = 0.265 m`. Actual UoM codes are used; this is the scoped material/vendor relationship, not a universal linear-to-area conversion. **Calculated area per material** comes from the Dimension Master formula; **Calculated area per product packaging unit** multiplies that area by the entered component quantity. Both areas are read-only and update automatically through a debounced, non-persisting server preview. Incomplete or invalid inputs leave the area blank with a message. The final pricing calculation uses the same formula/conversion resolver and overrides any earlier preview; saving its normal snapshot also captures these derived details. Count materials do not show this area section.

## Calculation rules

Let `q` be material quantity per product packaging unit, `F` be base units in one vendor price UoM, and `A` be formula area in m² per material:

| Basis | Vendor price units consumed per packaging unit |
| --- | --- |
| Count | `q / F` |
| Square meter | `q × A / F` |

Component unit price is vendor unit price times consumption. Product MOQ is `ceil(vendor MOQ / consumption)`. Final MOQ is the highest component product MOQ; unit packaging price is the sum of component prices. The final MOQ must stay within every selected price's quantity interval (upper bound exclusive); otherwise choose another effective tier.

The existing Pricing Master has quantity tiers, not a separate minimum-order field. The calculator explicitly uses **Quantity from as vendor MOQ**. Zero means no minimum. It does not estimate discounts or infer another vendor price tier.

- Two labels at 10,000 VND each, MOQ 5,000 labels: 20,000 VND and product MOQ 2,500.
- One material using 50 m², vendor unit supplies 250 m², price 10,000 VND and vendor MOQ 5,000: 2,000 VND and product MOQ 25,000.

Maintain the price-UoM/base-UoM relationship in either direction in Unit Conversion Master. Migration 64 automatically creates and synchronizes the reciprocal record (`1 / Factor`), which the calculator uses as a normal direct match. Vendor/material-specific factors override material-only factors, then general factors. Same UoM has factor one. No business factors are seeded and conversions are not chained. A linear-unit-to-area conversion must express that particular material's usable area, not a universal metre-to-square-metre relationship. Square-meter UoMs are recognized by codes `m2`, `m²`, `m^2`, `sqm`, `sq m` or a name of Square meter/metre (singular/plural).

If all component prices use one currency, the total remains in that currency. Mixed currencies require positive price-record ExchangeRateToUSD values and are normalized to USD (`vendor price / vendor currency per USD`). No raw cross-currency sum is allowed. USD rates are one. Prices round to nine decimals, consumption to twelve; all calculations use Python Decimal, not browser floating point.

## Save and security

Calculate → Apply to response → Review & save. Apply fills the matching response MOQ and **Primary price per unit** or **Secondary price per unit** with its currency, but does not write the database. Both price fields and **Primary MOQ unit** / **Secondary MOQ unit** are read-only; the server derives them from validated calculations, not submitted totals. Pending selections survive reopening the calculator. Changing either Type clears its obsolete MOQ/price and removes that order's pending calculation. Enter inside the calculator only recalculates. Cost basis is removed from the web Response; old stored Cost basis values are preserved during unrelated edits.

Response and pricing save in one transaction using the request item's RowVersion. The server recalculates from locked master records, checks the preview fingerprint and rejects changed prices, formulas, conversions, unit/type metadata, effective date or product-version context. Browser-supplied totals and formulas are forbidden. Admin and the assigned Packaging PIC can save on Assigned/Working/Returned items; PackagingManager can read/preview but not save. SQL rechecks identity, role, stage and PIC. Approved/canceled responses cannot be edited.

`dbo.PkgPricingMaster` stores each item/order calculation, totals, currency, date, input JSON, fingerprint and creator. Migration 65 adds explicit Opportunity Item, Opportunity, Product, Product Grade Version and Product Mix Version links, the Product RowVersion, copied request/product-version context, reference lineage and the full calculation JSON. Grade version is the active version at calculation time; mix version comes from the Opportunity's saved mix, including a mix child's parent version. Older snapshots receive only known item/product links; missing historical versions are not invented.

`dbo.PkgPricingComponent` stores quantities, dimensional measurements/definition/formula, price/tier/vendor metadata, original prices/currencies/rates, effective dates, conversion factors and component results as snapshots. Earlier calculations remain superseded, not deleted. Changing a response type supersedes its inconsistent current snapshot. Master changes do not rewrite saved values. The request change log records a pricing reference. Primary and Secondary prices are read from their current saved headers and follow existing response visibility rules; no duplicate editable price columns are maintained on the request item.

The request item's **View saved pricing** calculator icon reads up to 20 recent snapshots, even after approval or a master type is blocked. Its values, Opportunity Item/product versions, effective dates and dimension/formula details are read-only and do not depend on current masters. Current calculator catalogs and previews are not historical quotes.

## Reusing a setup

In the calculator, choose **Reference from another request**, then **Load reference**. Up to 100 saved setups from other items in the same packaging order are listed, with matching types first. Quantities and unchanged dimension measurements are copied as editable inputs, not saved totals. The target type's active descendant-material rules still apply.

The loader keeps the original vendor/currency/price UoM and refreshes the current effective price and its RowVersion. If the original price expired, a replacement is chosen only when there is one unambiguous current match. Incompatible or unavailable components are listed explicitly; add replacements and confirm omitted lines before calculating. Changed dimension definitions clear measurements and require re-entry. Calculate and Apply again before saving; the new header records `SourcePricingMasterID`, while the original snapshot stays unchanged. Loading, editing or calculating a reference does not write the database.

## Deployment

Apply `sql/63_pkg_pricing_master.sql`, `sql/64_unit_conversion_bidirectional.sql` and `sql/65_pkg_pricing_references.sql` in order after migration 62 to the existing `test` database. Migration 65 is additive and rerunnable; it preserves historical snapshots and does not seed quotes or business conversion factors. These migrations have been applied locally; VM deployment is separate.

Copy these updated API files to the VM: `core/main.py`, `core/packaging_api.py`, `core/packaging_fields.py`, `core/request_views.py`, `core/pkg_pricing.py`, `core/pkg_pricing_api.py`. Also deploy the rebuilt `webapp/dist` directory, restart the API, and hard-refresh the browser. All earlier dimension/type migrations and files must already be deployed. Layout, Excel templates and local-update macros are unchanged for this feature.

Verification: `tests/python/pkg_pricing_contract.py` uses rollback-only SQL fixtures and checks exact examples, currencies, tiers, dimensions, source changes, roles and atomic snapshots. `webapp/tests/pkg-pricing.spec.ts` covers selections, apply/save, dimension inputs, history, preview invalidation and 1920×1080/narrow viewports.

For the Effective date and live conversion/area display update, deploy `core/pkg_pricing_api.py` and the rebuilt `webapp/dist`, restart the API and hard-refresh the browser. No additional SQL migration, Layout or Excel changes are needed beyond the existing pricing migrations.

For the previous-component prices, automatic dimension choice and Secondary response price/MOQ update, deploy `core/pkg_pricing_api.py`, `core/packaging_fields.py`, `core/request_views.py` and the rebuilt `webapp/dist`. Restart the API and hard-refresh the browser. No new SQL migration is required beyond 63–65; existing saved totals are used rather than rewritten.
