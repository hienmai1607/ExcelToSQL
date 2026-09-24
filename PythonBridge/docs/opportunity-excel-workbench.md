# Opportunity Excel Local Update

Open **Opportunities** in the webapp and choose **Excel Local Update** in the toolbar. The download is Opportunity_Local_Update.xlsm. It follows both the header and item layouts, current filters, sort and page.

This is a new downloadable workbook; the existing Sales_Template.xlsm is not changed.

## Combined worksheet

Each row contains repeated Opportunity header fields followed by one item.

- **Header Command** is first. Blue column headers identify header input.
- **Item Command** is immediately before the item fields. Orange column headers identify item input.
- Darker blue/orange with an asterisk identifies required columns.
- Gray headers labeled **[display]** identify stages, Product details and Packaging responses. They cannot be changed through this workbook.
- IDs, RowVersions and original values are hidden technical columns. Do not clear or edit them.

Required columns remain selected in the web layout and included in every download. Header fields: Opportunity/group key, Customer, Description, Bid open, Bid close, Currency, Exchange rate to VND. Item fields: Product code, Description, Annual units.

The sheet is unprotected. Native Excel Hide is not blocked; Save/Refresh restores required columns. Do not move columns between the Header and Item groups or sort only part of a row. Use the web layout for column ordering and sort the complete worksheet range so IDs remain with their records.

## Commands

| Command | Header | Item |
| --- | --- | --- |
| N / blank | No explicit operation; changed input is detected | No explicit operation; changed input is detected |
| C | Create a new Opportunity | Create a new item |
| U | Update the existing header | Update the existing item |
| D | Delete the Opportunity, subject to existing SQL rules and references | Delete the item, subject to existing SQL rules and references |

Stage changes belong in the application, not Excel. Existing Opportunities/items must be Draft. Processing items are locked by the existing API/SQL rules.

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

Deploy templates/Opportunity_Local_Update.xlsm, core/opportunity_excel_api.py and the rebuilt webapp/dist with the API. Existing Opportunity migrations and procedures remain prerequisites; this feature adds no database tables/procedures.

The API uses workbook XML generation at runtime; Excel is not needed on the server. EXCEL_API_BASE_URL controls the URL embedded in downloads when needed. Authentication uses the workbook user's Windows identity; development header mode is only for trusted testing.

Rebuild the template on an approved developer desktop with Excel:
powershell -File scripts/build_opportunity_local_template.ps1

Re-sign/approve the rebuilt VBA artifact according to company policy.

Checks:
- tests/python/opportunity_excel_contract.py
- tests/python/opportunity_excel_sql_contract.py (local test database, rollback-only)
- webapp/tests/opportunity-excel.spec.ts
- scripts/test_opportunity_local_template.ps1 with a disposable fixture from scripts/opportunity_excel_smoke.py
