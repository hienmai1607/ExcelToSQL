# Excel-to-SQL User Guide

Version: 12 September 2026

This guide covers the entities currently available through the Excel workbooks:

- Admin Master: Market, Currency, Users, and User Access
- User Master: Product and Customer
- Transaction: Opportunity header and Opportunity items
- Packaging: Material, Price, request responses, approved reference and Manual Request

Opportunity changes made through Excel or the web app can be viewed in Presales
PL3.0: open the Opportunity and select the history icon beside its item controls.
The log shows header/item, field, old/new value, user, source and UTC+7 time (AM/PM). Use
the level/source/field filters and page-size control to narrow the list.
Logging starts when migration 21 is installed; earlier field edits are not
reconstructed. See [Opportunity change log](opportunity-change-log.md).

## 1. Workbooks and access

| Workbook | Entities | Who can maintain data |
| --- | --- | --- |
| `Admin_Master.xlsm` | Market, Currency, Users, User Access | Active users with `Admin` access |
| `Product_Template.xlsm` | Product | Active users with `Product` or `Admin` access |
| `Sales_Template.xlsm` | Customer | Active users with `Customer` or `Admin` access |
| `Sales_Template.xlsm` | Opportunity header and items | Active users with `Opportunity` or `Admin` access |
| `Packaging_Template.xlsm` | Packaging Material and Price | Active users with `Packaging` access |
| `Packaging_Template.xlsm` | Packaging request responses | Assigned PIC with `Packaging` access |
| `Packaging_Template.xlsm` | Manual Request creation | Active users with `Opportunity` or `Admin` access |

An Opportunity user may read Customer and Product reference data for dropdowns, but this does not grant permission to maintain those masters.

The API identifies the user from the Windows account running the bridge in local mode, or from the authenticated proxy in central mode. Typing another username in Swagger or a request does not change the authenticated identity.

## 2. Before starting

1. Connect to the required company network or VPN.
2. Confirm that the Python API is running and accessible.
3. Open the correct `.xlsm` workbook and enable macros.
4. Click **Refresh** before editing existing rows.
5. Work only in visible input columns. Do not unhide or change ID or RowVersion columns.

The worksheets are intentionally not protected. This allows normal user interaction, but it also means care is required not to move columns, rename headers, delete buttons, or edit hidden technical values.

## 3. Standard commands

Enter one command in the Command column for every row to be saved.

| Command | Meaning |
| --- | --- |
| `C` | Create a new record |
| `U` | Update the refreshed record |
| `D` | Delete, deactivate, or block the record, depending on the entity |
| `N` | No change; the row is not submitted |

Commands are not case-sensitive. After Refresh, loaded rows have command `N`.

The effect of `D` is entity-specific:

| Entity | Effect of `D` |
| --- | --- |
| Market, Currency, User Access | Permanent delete; deletion can fail while the record is referenced |
| Users | Deactivate the user (`Is Active = FALSE`) |
| Product, Customer | Block the record (`Status = Block`) |
| Opportunity header/item | Delete a Draft record; delete items before deleting their header |

## 4. Standard save and refresh process

### Create

1. Use a blank row.
2. Enter `C` in its Command column.
3. Complete all required fields.
4. Click **Save**.
5. Review the shared Save confirmation and choose **Yes**. **No** is the default.
6. Check Result Status and Message.
7. Click **Refresh** to verify the saved database values.

### Update

1. Click **Refresh** first so the current ID and RowVersion are loaded.
2. Change the visible fields.
3. Change the row command from `N` to `U`.
4. Click **Save**. Confirm the operation when prompted, and check its result.

### Delete, deactivate, or block

1. Click **Refresh** first.
2. Change the command to `D`.
3. Click **Save** and read any confirmation carefully.
4. Check the result before refreshing.

### Refresh

Refresh replaces the displayed database rows. If unsaved `C`, `U`, or `D` commands exist, Excel asks whether to discard them. Choose **No** if the changes still need to be saved.

## 5. Admin Master

Admin Master data changes infrequently and is restricted to administrators.

### Market

Visible fields are Command, Market Code, Market Name, Result Status, and Message. ID and RowVersion are hidden.

- Create: enter `C`, Market Code, and Market Name.
- Update: refresh, edit the code or name, then enter `U`.
- Delete: refresh and enter `D`. This is permanent and can be rejected if Customers still reference the Market.
- Market Code and Market Name must be unique.

### Currency

Visible fields are Command, Currency Code, Currency Name, Result Status, and Message. ID and RowVersion are hidden.

- Create: enter `C`, Currency Code, and Currency Name.
- Update: refresh, edit the code or name, then enter `U`.
- Delete: refresh and enter `D`. This is permanent and can be rejected if Customers still reference the Currency.
- Currency Code must be unique.

### Users

Visible fields are Command, User Name, Is Active, Result Status, and Message. ID and RowVersion are hidden.

- Create: enter `C`, the user's authenticated Windows/proxy name, and `TRUE` for Is Active.
- Update: refresh, edit the user name or select `TRUE`/`FALSE`, then enter `U`.
- Deactivate: refresh and enter `D`. The record remains in the database but becomes inactive.
- An inactive user cannot use the API, even if User Access rows still exist.
- User Name must be unique.

Use the same user-name format supplied by the authentication system. In local Windows mode this is normally the Windows account running the API.

### User Access

Visible fields are Command, User Name, Scope, Result Status, and Message. Access ID, User ID, and RowVersion are hidden.

Available scopes are:

- `Admin`
- `Customer`
- `Product`
- `Opportunity`

Before maintaining User Access, refresh **Users** so the User Name dropdown and hidden User ID values are current.

- Create: enter `C`, select User Name, and select Scope.
- Update: refresh, change User Name or Scope, then enter `U`.
- Delete: refresh and enter `D`. This permanently removes that access assignment.
- Do not assign the same scope to the same user more than once.

Take care when removing administrator access. Always retain at least one tested, active administrator account.

## 6. Product Master

Product is maintained in `Product_Template.xlsm`.

| Field | Rule |
| --- | --- |
| Product Code | Required and unique |
| Product Name | Required and unique |
| Weight Value | Required, numeric, and greater than zero |
| Weight Unit | Select `g` or `oz` |
| Status | `Active` or `Block`; a Create defaults to Active |

The database stores weight in grams. After Refresh, a weight originally entered in ounces may be displayed as its normalized gram value with unit `g`.

`D` blocks a Product; it does not physically delete it. A blocked Product remains in history but cannot be selected for a new or edited Opportunity item. To reactivate it, refresh the row, set Status to `Active`, enter `U`, and save.

### Product search and paging

Use the Product Code and Product Name filter cells, then click **Refresh**. Each page contains up to 200 Products. Use **Previous** and **Next** to change pages. Loaded shows the rows on the current page; Total shows all records matching the filters.

Save or discard pending edits before changing a filter or page.

## 7. Customer Master

Customer is maintained on the Customer sheet in `Sales_Template.xlsm`.

| Field | Rule |
| --- | --- |
| Customer Name | Required and unique |
| Market Code | Required; select from the dropdown |
| Currency Code | Required; select from the dropdown |
| Status | `Active` or `Block`; optional on Create and defaults to Active |

Customer Refresh also refreshes the Market and Currency lookup lists. If a newly created Market or Currency does not appear, refresh Customer again.

`D` blocks a Customer; it does not physically delete it. A blocked Customer remains in history but cannot be used for a new or edited Opportunity. To reactivate it, refresh, set Status to `Active`, enter `U`, and save.

### Customer search and paging

Customer supports Customer Name, Market Code, and Status filters. Each page contains up to 200 Customers. Use **Previous** and **Next** to navigate. Save or discard pending edits before changing filters or pages.

## 8. Opportunity transaction

The Opportunity sheet combines one header and its items in a single grid. Header fields are repeated on each displayed item row so users can see the complete transaction together.

| Header fields | Item fields |
| --- | --- |
| Header Command | Item Command |
| Opportunity Number | Product Code |
| Customer Name | Item Description |
| Opportunity Description | Annual Unit |
| Bid Open | Estimated % Awarded |
| Bid Close | Shelf Price |
| Header Stage | Item Stage |

Status and Message show save results. Hidden columns contain header/item IDs, RowVersions, Customer ID, and Product ID.

### Create one header with items

Use the same temporary Opportunity Number on the header row and every related item row. The server replaces it with the official number after Save.

Example with two items:

| Header Command | Opportunity Number | Customer Name | Opportunity Desc | Bid Open | Bid Close | Item Command | Product Code | Item Description | Annual Unit | Estimated % Awarded | Shelf Price |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |
| `C` | `NEW-001` | `8avenue` | `FY27 test opportunity` | `01-Oct-2026` | `31-Oct-2026` | `C` | `Product 1` | `First item` | 1000 | 50 | 12.50 |
| blank | `NEW-001` | blank | blank | blank | blank | `C` | `Product 2` | `Second item` | 500 | blank | blank |

Notes:

- Use an existing Active Customer and Active Products from the dropdowns.
- The first row creates the header and its first item. Additional rows need only the same temporary number and their item fields.
- The official Opportunity Number is generated by the server, for example `OPP-2026-00001`.
- Header Stage and Item Stage default to `Draft`.
- Bid Close must be on or after Bid Open.
- Estimated % Awarded may be blank or from 0 to 100.
- Blank Estimated % Awarded or Shelf Price remains database `NULL`; blank is not converted to zero.
- The same Product Code cannot appear twice in one Opportunity.

### Update a header

1. Refresh and locate the Opportunity.
2. Edit header fields on one row belonging to that Opportunity.
3. Set Header Command to `U` on that row.
4. Leave Item Command as `N` unless an item also needs changing.
5. Click **Save** and review Status and Message.

Do not put Header Command `U` on every repeated item row. One header command is enough.

### Update an item

1. Refresh and locate the item.
2. Edit its item fields.
3. Set Item Command to `U` on that row.
4. Leave Header Command as `N` unless the header also needs changing.
5. Click **Save**.

### Add an item to an existing Opportunity

Add a new row using the existing Opportunity Number, set Item Command to `C`, and complete the item fields. The Opportunity must still be Draft.

### Delete Draft data

- To delete an item, refresh it, set Item Command to `D`, and save.
- To delete a header, first delete all its items. Then refresh, set Header Command to `D`, and save.
- Excel cannot update or delete an Opportunity header or item after it leaves Draft.

For business cancellation after workflow starts, use the workflow application rather than deleting the transaction.

### Stages and workflow

Header Stage and Item Stage are visible for information but are not maintained by Excel. The sheets remain unprotected, so a user can type in these cells, but Save intentionally does not send those values. Refresh restores the authoritative database stages.

Stage changes belong to the workflow application, such as PowerApps. SQL Server validates the requested transition, authorization, current RowVersion, and audit history.

### Opportunity search and paging

Available filters are Opportunity Number, Customer Name, Header Stage, Bid Open From, and Bid Open To.

Each page contains up to 200 Opportunity headers. Because all items for a selected header are kept together, the number of visible worksheet rows can exceed 200. **Previous** and **Next** move between header pages.

Save or discard pending edits before filtering, refreshing, or changing pages.

## 9. Understanding results

| Result | Meaning | Action |
| --- | --- | --- |
| `OK` | The row was processed successfully | Refresh to verify |
| `ERROR` | The row was rejected | Read Message, correct the row, and save again |

A batch can contain both successful and failed rows. Review every changed row rather than relying only on the popup message.

## 10. Common errors

| Message | Meaning and recovery |
| --- | --- |
| `Username is incorrect.` | The authenticated user is blank, unknown, or inactive. Ask an administrator to verify Users and the deployment identity. |
| `Admin/Product/Customer/Opportunity access is required for this action.` | The user exists but lacks the required active scope. Ask an administrator to check User Access. |
| `Update/Delete requires ID and RowVersion. Refresh first.` | The row was typed manually or its hidden keys are missing. Refresh and edit the loaded row. |
| `Concurrency conflict or not found` | Another user changed/deleted the record after your Refresh. Copy any unsaved values elsewhere, refresh, review the latest row, and re-enter the change if still appropriate. |
| `Row not found` | The database record no longer exists. Refresh the sheet. |
| `Active Customer/Product is required` | The selected master is missing or blocked. Refresh the lookup and select an Active value. |
| `Market/Currency Code was not found` | Customer lookup data is stale or the code is invalid. Refresh Customer and select from its dropdown. |
| `Excel can modify only Draft...` | Workflow has started. Make the required change through the workflow application/process. |
| `Unsaved changes will be discarded` | Refresh or paging detected pending commands. Choose **No** to keep working or **Yes** to reload. |
| `Excel/API version mismatch` | The workbook and running API are from different releases. Restart/update the API or obtain the matching workbook. |
| `API call failed` | The bridge is unavailable or returned a server error. Confirm the API/network, then provide the full API log to support. |

## 11. Good operating practices

- Refresh immediately before updates, blocks, deactivations, or deletes.
- Keep save batches manageable; the workbook pages 200 records and the API accepts at most 500 submitted rows per batch.
- Do not sort only part of the Opportunity grid because header/item relationships depend on complete rows staying together.
- Do not copy hidden ID or RowVersion values between rows or workbooks.
- Use dropdown values exactly as supplied.
- Check every Result Status and Message before Refresh clears the working results.
- Use a controlled, versioned copy of each workbook and do not change its VBA or column layout.
- Close the workbook before an administrator installs a workbook update.

## 12. Support information

When reporting a problem, provide:

- workbook name and sheet name;
- action attempted: Refresh, Create, Update, Delete/Block, or paging;
- row number and the exact Status/Message or popup text;
- approximate time of the error;
- API log/traceback when an HTTP 500 error occurred;
- a screenshot with confidential data removed where necessary.

Technical owners can also refer to [Bridge authentication and deployment](authentication-and-deployment.md) and [Transaction model](transaction-model.md).

## 13. Packaging workbook

### Pagination in all workbooks

Enter a whole number from 1 to 500 in the highlighted page-size cell; the
default is 200. Click Refresh to load page 1 with the selected size.

| Sheet | Page-size cell | Unit |
| --- | --- | --- |
| Market, Currency, Users, User Access | N8 | Rows |
| Product | N8 | Rows |
| Customer | M9 | Rows |
| Opportunity | X7 | Headers, including all their items |
| All Packaging data sheets | BB4 | Rows |

Previous/Next uses the selected size. Changing the size or filters starts at
page 1; after reopening Excel, Refresh establishes the current paging state.
Canceling discard confirmation or a failed API read leaves the displayed page
and unsaved rows intact. Opportunity may display more rows than its header limit.
Admin Master slices the full authorized list returned by its existing API;
Customer, Product, Opportunity and Packaging request pages from the server.

Open Packaging_Template.xlsm after updating/restarting the API. Each data table
starts at row 1. The Save, Refresh, Previous and Next buttons sit beside the table
at BA1:BD1; intervening unused columns are hidden.

| Cell | Meaning |
| --- | --- |
| BB4 | Rows per page: enter a whole number from 1 to 500; default 200 |
| BB5 | Page number |
| BB6 | Total matching records |
| BB7 | Number of loaded records |
| BB8 | Optional prefix filter: Material code/name or Opportunity number |

Click Refresh after changing the page size or filter; this starts at page 1.
Previous/Next navigate additional records. Sorting and table-header filtering
apply to the loaded page. Save includes changed rows hidden by filters and asks
for confirmation. Save or explicitly discard pending commands before refreshing.
All worksheets remain unprotected; hidden IDs and RowVersions must not be edited.

Packaging Material and Packaging Price follow C/U/D/N commands. D blocks rather
than deletes. Use existing Material and Currency codes for Price. Price requires
a basis, quantity-from, unit price and effective-from date. Blank upper quantity
or effective-to means no upper limit. Overlapping active price bands are rejected.
Packaging or Admin scope is required for maintenance.

Packaging Request saves U commands on responses assigned to the current PIC.
Admin can also save responses assigned to another PIC, subject to the same
editable-stage and RowVersion checks.
Enter Material Code, dimensions in mm, Cost, Currency, Cost Basis and response
notes as needed. Blank numbers remain blank in SQL; zero is a real value.
Pending Review, Approved and Canceled responses cannot be edited. PIC assignment,
submission and manager decisions remain API/app actions. Typing a different PIC
or stage in Excel does not change them.

Packaging History displays approved current records for reference. It uses the
same request tables, not a separate history table. Save on that sheet does not
change data.

### Manual Request for testing

1. Create the Draft Opportunity and its items in Sales_Template first.
2. Open Manual Request and click Refresh. Optionally enter an Opportunity number
   prefix in BB8 to find it.
3. Set Command to C on the source items to include.
4. Enter Response Due on every selected row. Rows from one Opportunity must have
   the same Response Due and Request Notes; Packaging Requirement is per item.
5. Click Save and confirm. One request is created per selected Opportunity.
6. Check Created Request Number, Result Status and Message, then refresh Packaging
   Request to see the new request.

This sheet selects existing Opportunity information; it does not create or edit
Opportunity headers/items. Source items with an open Packaging request are
excluded from Refresh. Save the current page before selecting items on another
page; each save creates a separate request for its selection.

If a network error makes creation uncertain, retry Save with the same selection
and values. The workbook persists hidden retry keys before posting, so a retry
can recover the original request without creating a duplicate. Do not clear keys
or change the pending payload until the result is reconciled.

Before entering responses, a Packaging Manager must assign the PIC using
`POST /api/packaging/items/{item_id}/assign` (Swagger can be used during testing).
The payload contains PICUserID and the current ExpectedRowVersion. The assigned
user needs Packaging or Admin access; the manager needs PackagingManager or Admin access.

### Common confirmation dialogs

All four workbooks use the same Save and discard-changes confirmation style,
with **No** selected by default. Save summarizes Create, Update and the actual
removal action: Delete, Block or Deactivate. Counts include rows hidden by filters.
Opportunity includes separate header/item totals; Manual Request includes the
number of requests and selected items. Review the counts before choosing Yes.

Technical details: [Packaging model and deployment](packaging-model.md).

## Packaging Request change history

Open a request and click the history icon beside Close/Refresh to see header and item changes. Filter by level, source or field and adjust rows per page. Times use UTC+7 and AM/PM. Logging starts when enabled; it does not reconstruct older edits. See [Packaging Request changes log](packaging-request-change-log.md) for coverage and access rules.

## Packaging Request saved specifications

Each new request saves its Product information, Opportunity item requirements, and source currency/exchange rate. Later source changes do not alter the request. Specifications are read-only; cancel and recreate an affected item when requirements change. PICs continue editing response fields normally. Existing requests show a migration-time snapshot notice for fields added later. See [snapshot rules](packaging-request-snapshots.md).
