# Opportunity Excel Local Update

Open **Opportunities** in the webapp and choose **Excel Local Update** in the toolbar. The download is Opportunity_Local_Update.xlsm. It follows both the header and item layouts, current filters, sort and page.

This is a new downloadable workbook; the existing Sales_Template.xlsm is not changed.

## Section headers and field colors

New downloads use workbook format 2. Download a fresh workbook after deploying
this update; do not paste data over the section/header rows.

- Row 1: merged section headings following the downloaded column order and visibility.
  Groups include Opportunity, Product Info, Packaging requirements, Shipment,
  Logistics, Co-Man, Others and Packaging responses.
- Row 2: merged subgroups, such as Packing Way, Palletization and Primary/Secondary/Tertiary packaging.
  Technical field keys are stored in row 10 of the hidden _Config sheet.
- Row 3: field labels, with a matching color for their subgroup.
- Row 4: the final colored header/filter row: **green = Editable**,
  **blue = Auto calculate**, **gray = Display only**, with an asterisk for required inputs.
- Data starts on row 5. The first four rows stay frozen while scrolling.
  Groups, subgroups and field labels use distinct, stable colors on rows 1-3.
  Row 4 keeps the separate edit-status colors. Data cells have no fill and thin
  borders. Data uses normal,
  nonwrapping text at a fixed 18-point height; hidden metadata cannot expand rows.
  The same formatting is reapplied on Refresh, Save, Add Item and New Opportunity.
- Controls includes the field-category legend. Group/subgroup colors identify
  layout sections; row-4 colors identify editability independently.

Shipment and cost fields are separate layout columns, not a raw JSON editor.
Hidden values are preserved when visible fields are edited. USD amounts and
percentages display two decimal places. Enter the Port of Entry **name**, matching
an active record for the Opportunity Customer and its current Market.
Configuration, Loading, Incoterm and Container cells have list dropdowns.
Port codes are neither shown nor entered.

## Combined worksheet

Each row contains repeated Opportunity header fields followed by one item.

- **Header Command** is first. The Opportunity section identifies header input.
- **Item Command** is immediately before the item fields. Section headings identify their groups.
- An asterisk identifies required columns; row 4 carries the editing-category color.
- Fields labeled **[display]** identify stages, Product details and Packaging responses. They cannot be changed through this workbook; their row-4 category is gray (or blue for calculated output).
- IDs, RowVersions and original values are hidden technical columns. Do not clear or edit them.

Required columns remain selected in the web layout and included in every download. Header fields: Opportunity/group key, Customer, Description, Bid open, Bid close, Currency, Exchange rate to VND. Item inputs: Product code and Annual units. The product name supplies the internal item description on new rows.

The sheet is unprotected. Native Excel Hide is not blocked; Save/Refresh restores required columns. Do not move columns between the Header and Item groups or sort only part of a row. Use the web layout for column ordering and sort the complete worksheet range so IDs remain with their records.

## Commands

| Command | Header | Item |
| --- | --- | --- |
| N / blank | No explicit operation; changed input is detected | No explicit operation; changed input is detected |
| C | Create a new Opportunity | Create a new item |
| U | Update the existing header | Update the existing item |
| D | Delete the Opportunity, subject to existing SQL rules and references | Delete the item, subject to existing SQL rules and references |

Stage changes belong in the application, not Excel. Existing Opportunities/items must be Draft. For processing items, Product Info and Packaging requirements stay locked, including Configuration request and Loading request. Other Shipment, Logistics, Co-Man and Others inputs remain editable for regular products and Mix parents. Mix children inherit that section read-only. Existing PCR snapshots do not change.

### Create an Opportunity with multiple items

1. On Controls, click **New Opportunity**. A new row has Header Command C, Item Command C and an XL-... group key.
2. Enter the required header fields. Customer name, Product code and Currency code must match existing master records. VND requires an exchange rate of 1.
3. Enter the first item's fields.
4. Select this row and press **Ctrl+Shift+I** to add another item. Alternatively, run the OpportunityAddItem macro while the source row is selected. The header and group key are copied; enter the new item's details.
5. On Controls, click **Save**, review the shared confirmation, then confirm.

The temporary group key links the new rows; SQL assigns the actual Opportunity number. Repeated headers must agree. Conflicting repeated values are rejected, not silently overwritten.

### Update or delete

Edit header values on one row, or repeat exactly the same change on multiple rows. The adapter merges them into one header operation. Edit item values on their own rows. Blank optional numeric values stay null, not zero.

Use Item Command D to delete an item. To delete a whole Opportunity, use Header Command D without separate item edits; existing references may prevent deletion. Removing cells/rows in Excel is not a database delete.

Save results appear per worksheet row. Failed documents retain their entries. Each Opportunity saves atomically through the existing document writer and change-log mechanisms. Separate Opportunities can succeed/fail independently. A lost/unknown Save response blocks retry until Refresh and reconciliation.

## Refresh, filter and paging

Controls provides Save, Refresh, Filter, Previous, Next and New Opportunity.

- Page size accepts 1–500 **Opportunities**, not flattened item rows.
- All items for a header remain together, so the worksheet can contain more rows than the page size.
- Filters include Opportunity number prefix, Customer name prefix, header stage and bid-open date range.
- Use YYYY-MM-DD for date filters.
- Refresh asks before discarding unsaved edits.
- Save accepts at most 500 changed headers and 500 changed items. The workbook may send up to 10,000 loaded rows for repeated-header reconciliation.

## Deployment and verification

Deploy templates/Opportunity_Local_Update.xlsm, the matching core/ source (including opportunity_excel_sheet.py and shipment_columns.py) and the rebuilt webapp/dist with the API. Existing Opportunity migrations and procedures remain prerequisites; the Shipment/Port master requires migrations 89 then 90.

The API uses workbook XML generation at runtime; Excel is not needed on the server. EXCEL_API_BASE_URL controls the URL embedded in downloads when needed. Authentication uses the workbook user's Windows identity; development header mode is only for trusted testing.

Rebuild the template on an approved developer desktop with Excel:
powershell -File scripts/build_opportunity_local_template.ps1

Re-sign/approve the rebuilt VBA artifact according to company policy.

Checks:
- tests/python/opportunity_excel_contract.py
- tests/python/opportunity_excel_sql_contract.py (local test database, rollback-only)
- webapp/tests/opportunity-excel.spec.ts
- scripts/opportunity_excel_layout_smoke.py (disposable loopback fixture; no database writes)
- scripts/test_opportunity_local_template.ps1 with a disposable fixture from scripts/opportunity_excel_smoke.py

### Row-level edit guidance

The row 4 category describes a column's normal use, not permission for every row. Gray italic input cells are inherited or locked. Select a cell to see its lock reason; inherited shipment/cost inputs identify the Mix parent row to edit. These cues apply to downloads and VBA Refresh. Draft, processing, and parent/child save restrictions remain unchanged. Download a fresh workbook to receive the updated VBA; existing workbooks are not modified.
