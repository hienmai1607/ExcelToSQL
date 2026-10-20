# Date presentation and categorized UoMs

## User settings

Open Settings from the sidebar controls. Date choices are mm/dd/yyyy, dd/mm/yyyy, yyyy-mm-dd and dd.mm.yyyy; timestamps combine that date format with 12-hour or 24-hour time. Preferences are private to the signed-in user and use the existing row-version-protected preference API. Legacy profiles receive defaults.

Shared date inputs parse the selected presentation format into ISO values, with calendar selection retained. Date-only values do not shift timezone. Audit timestamps retain Asia/Bangkok display of UTC instants, including timestamps without an explicit suffix. Shared list/date/price/AI timestamp renderers use these preferences. API contracts and editable local workbook values remain ISO to prevent ambiguous updates. Settings changes do not change stored business dates.

## Unit master

Apply sql/126_uom_categories.sql before deploying this code. This has been applied to the local desktop test database without changing Customer/Product data.

Admin-maintained categories: Weight/Mass, Length/Distance, Area, Volume, Unit/Count and Other. BaseFactor is a positive conversion factor to the category base: g, mm, mm2, ml, EA respectively. Other is descriptive and must not be used for product mass. Existing mass and distance units are classified once; subsequent migration runs preserve Admin edits. Grams are added if absent.

Products select active Weight/Mass units alongside the weight input. Server-side UoM lookup supplies the conversion factor; client factors are not trusted. Canonical product weight remains grams, preserving downstream packaging calculations and the existing SQL/Excel product contract. Product edit displays canonical grams (or legacy ounces for unusually large values); it does not persist the originally entered display unit. Material/vendor quantity conversions remain maintained through Unit Conversions.

UoM code/name/category/factor writes share one SQL transaction, preserve role and row-version checks, and return the final row version. UoM editing remains Admin-only. Non-mass or blocked units cannot be used for product weight.

The shared master template family is now master-3. Download a fresh template; old templates cannot update records. Local UoM templates expose Category and BaseFactor with category dropdowns.

## Optional Opportunity pallet

Apply sql/127_optional_opportunity_pallet.sql after 126. Pallet size is optional for new and edited Opportunities, including local Excel. A supplied size must still be valid or preserve an unchanged historical value. Exact Container Type remains required; the response load/pallet calculators still need real dimensions when calculating. No stored response snapshots are rewritten.

The Opportunity template family is now opportunity-4; download a fresh workbook. Header date, select and exchange-rate controls use the same 32px height and font sizing across desktop/tablet/mobile.

## Checks

- python tests/python/uom_categories_contract.py
- python tests/python/excel_template_version_contract.py
- npx playwright test tests/date-uom-settings.spec.ts tests/category-master.spec.ts tests/nested-master-create.spec.ts
- scripts/test_local_dropdown_flags.ps1 (real desktop Excel)
