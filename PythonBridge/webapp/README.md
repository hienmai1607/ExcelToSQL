# Opportunity Workbench

React/TypeScript UI using the existing FastAPI and SQL test database.

## Run
In webapp/:
    npm.cmd ci
    npm.cmd run build

Start/restart the API from the project root using the existing Python environment:
    python -m uvicorn main:app --app-dir core --host 127.0.0.1 --port 8000

Open http://127.0.0.1:8000/workbench/ . Build before API startup so it mounts dist/.
For development, run npm.cmd run dev in webapp/; open http://127.0.0.1:5173/workbench/ with API on port 8000.

## Use

### Opportunity change log

Open an Opportunity and select the history icon in its item toolbar. The log
combines header and item field changes with old/new values, user, source and UTC+7 (AM/PM)
time. Filter by level/source/field and choose rows per page.
Apply sql/21_opportunity_change_log.sql to the existing test database and restart
the API before using this feature. Changes are captured from installation onward.
See docs/opportunity-change-log.md for system-job attribution and deployment.

### Packaging requests

The request list uses the same compact transaction design as Opportunities:
icon Refresh/Layout/Sort tasks, clickable request numbers, saved column visibility
and order, optional search/status filters, and editable rows per page.
The item section has a separate saved layout/sort, a boxed table, and left-aligned
Close/Refresh/Layout/Sort controls. Both header and item sorting run before SQL
pagination. Existing PIC assignment remains manager/admin-only, stage-checked,
confirmed and protected by RowVersion. Documents and request notes remain available.
New sorted item reads expose source/assignment information only, not unapproved
Packaging response costs or dimensions. No new database objects are needed;
restart the API and hard-refresh the browser after rebuilding.

### Products

Products is a user-master section for Product and Admin users, following the
Customer interaction model: icon tasks, stacked create sections, confirmation,
single-record editing, original RowVersion checks, status Active/Block, saved
column order/visibility, filters, multi-sort and current-page Excel export.
Search matches product code/name prefixes; Created by shows usernames.
The Product profile is independent of Customer and Packaging layouts.

Enter code, name and a positive weight in grams or ounces (up to four decimals).
SQL converts to grams at two decimals and supplies the ounces display. Edit
defaults to grams; exceptionally large gram values use ounces to fit the existing
input type. Duplicate codes/names within a create form are rejected. Partial
batch failures retain failed rows without resubmitting successes.

Writes reuse /api/product/batch and existing tables/procedures. The new sorted
read rechecks Product/Admin in SQL and requires SELECT access, as other workbench
read models do. No SQL migration is needed. Restart the API and hard-refresh the
browser after building. Opportunity's existing read-only product lookup remains
unchanged; unrelated master roles cannot access this maintenance section.

### Opportunities

- An Opportunity item can have only one open Packaging Request at a time.
  Its checkbox is disabled and shows the active request number/stage.
  Assigned, Working, Pending Review and Returned all remain open; Approved
  (completed in this model) and Canceled release that item for another request.
  Refresh Opportunities after completion/cancellation. The restriction is per
  request item, not the whole request header. Existing Draft-stage rules still
  apply. SQL locking and the filtered unique index enforce this even when users
  submit concurrently or bypass the browser. A retry using the same CreationKey
  retrieves the original request rather than creating a second one.

- Pencil icons in the overview and detail panel edit the header and items
  together; the item pencil opens the same form at that item. Only Draft headers
  and Draft items are editable. Non-Draft items are shown read-only. Existing
  items cannot be removed in this edit screen; newly added unsaved items can.
- Update sends the original header RowVersion plus only changed/new item rows
  and their original RowVersions. Even an item-only edit includes the header
  version as a document-level concurrency check. Conflicts preserve entered
  values; close, refresh and reconcile before retrying.
- Header and item tables each have Layout and Sort icons. Select visible columns,
  move them left/right, and set multiple sort rules in priority order. Clicking
  a column sorts it; Shift-click adds another rule. Save layout to profile to
  remember both column choices and sort rules independently for the two tables.
  Header sort runs in SQL before header pagination. Item sort is numeric-aware
  across the selected Opportunity's complete items, with blanks last.
- Restart the API after this update, then hard-refresh the browser. Existing
  profile storage is reused; no new migration is required. The sorted read uses
  parameterized SQL with allow-listed sort fields and rechecks the live SQL role.
  As with other workbench read models, the API SQL account needs SELECT access;
  EXECUTE-only company deployments should put this read into an approved procedure.

- Overview shows one row per Opportunity, with customer, description, bid dates,
  stage and item count. Filter by number/customer prefix or stage; enter 1–500
  Opportunities per page. Click its number or details icon to see all its items.
- Use the plus icon in the table header to create one Opportunity. Choose an
  active customer, enter description and bid dates, then add up to 500 items.
  Each item requires an active product, description and whole annual units.
  Products must be unique within the Opportunity. Optional award percentage
  and shelf price support two decimals; blanks remain NULL rather than zero.
- Review and confirm once. The existing API/SQL saves the header and items as
  one document, generates the number, and sets header/items to Draft.
  Opportunity or Admin access is required. No stage editing is added here.
- SQL errors retain the form. An uncertain network/server result disables
  another submission: close and refresh/reconcile before creating again.
  The temporary header/item linking key is not an idempotency token.
- Existing Packaging Request selection, requirements and attachments remain
  available in the detail panel. Draft form data survives the inactivity lock
  while this browser tab stays open, but not a reload or browser close.
- This UI change reuses existing endpoints and migrations; rebuild the webapp
  and hard-refresh the browser. No additional SQL migration is needed.

### Packaging master sections

The sidebar includes Packaging Material and Packaging Material Pricing.
Packaging and Admin can create/update; PackagingManager has read-only access.
Both use the same compact task bar, icon actions, server pagination and sorting,
current-page XLSX export, audit usernames, and profile layout/order choices as
Customer. Layouts are saved independently for each master.

Use the plus icon to add up to 500 record sections, review and confirm one batch.
Edits include the original RowVersion. Conflicts retain entered values; partial
success locks successful sections so only failures are retried. Unknown network
outcomes disable resubmission until the user closes and reconciles the list.
Status can be changed through the edit form; no physical-delete action is exposed.

Material requires code, name and unit of measure. Description is optional.
Pricing requires material, currency, price basis, quantity from, unit price and
effective-from date. Quantity from is inclusive; optional quantity to is exclusive.
Blank quantity-to and effective-to remain NULL. Values support four decimals,
including zero prices, and date inputs send date-only values. SQL remains
authoritative for active references and overlapping price/date ranges.

Restart the API and rebuild webapp/dist to load the new sections. No new SQL
migration or database is needed: tables/types/write procedures from migrations
13–16 and profile storage from 18 are reused. Browser reads use parameterized
queries after usp_Packaging_Authorize, with allow-listed sort columns. As with the
existing Workbench read models, the API account needs SELECT on the relevant
master/User tables; EXECUTE-only deployments should move these reads into
approved stored procedures.

- Sign in with the configured API identity before entering the workspace.
- After 10 minutes without keyboard, pointer, touch or scrolling activity, the
  sign-in screen locks the workspace. Returning from sleep/background checks
  elapsed time before allowing interaction. API/background work is not activity.
- Same-user sign-in rechecks the active user and current permissions through
  /api/workbench/session. The screen and unsaved forms stay mounted in memory,
  including multi-customer sections and pending confirmations. Other accounts
  cannot resume that work. In-flight saves/uploads may finish while locked.
- Keep the tab open: refresh, closing the tab or a browser crash may lose
  unsaved form data. Draft recovery across browser restarts is not implemented.
- This is a client inactivity lock, not password authentication, identity-provider
  logout or API-session expiration. Windows/SSO may sign in without another
  credential prompt. Production reauthentication/expiry belongs to the company
  identity provider/proxy. In local_windows mode the API process account remains
  the identity for all browsers. Development username entry is only for explicitly
  enabled development_header mode, never a production authentication mechanism.
- Restart the API for stable UserID verification, then refresh the webapp.
- Opportunities: filter number/customer prefix and stage; view details; select Draft items; enter response due, notes and item requirements; confirm creation.
- Packaging requests: filter request/opportunity/customer prefix and status; view items; select PIC; confirm assignment.
- Admin has both actions. Opportunity can create; PackagingManager can assign. SQL enforces roles, stages and RowVersions.
- Page size: 1-500. Opportunity pages count headers and include their items.
- A lost create reply retains the identical pending payload in browser localStorage under the verified username. Retry it; do not clear browser storage until reconciled.
- After an assignment conflict, Refresh items before retrying.

## Local item attachments

Apply sql/17_packaging_attachments.sql to the existing test database, rebuild the frontend and restart the API.
When selecting Opportunity items, choose files beside each item. Creation saves the request first, then uploads the files to the new request item IDs.
The browser IndexedDB queue preserves files and upload keys across reloads. Failed uploads can be retried without recreating requests or duplicate attachment rows.
In Packaging Request details, expand Attachments to download files or upload additional ones.

Default files folder on this desktop: C:\Users\Admin\AppData\Local\PythonBridge\attachments.
Set ATTACHMENT_ROOT in the API process environment to override it; the folder must be outside this project.
The API account needs write access. Back up this folder together with SQL metadata; it is not served as a public static directory.
Files have opaque generated names; SQL retains the original filename, item ID, size, hash, uploader and time.
No request-history table is introduced.

Limits: 10 MB per file, 20 files per item. Allowed: PDF, PNG/JPG, DOCX/XLSX/PPTX, TXT/CSV, EML/MSG.
Active requesters with Opportunity access, assigned Packaging PICs, PackagingManager and Admin can upload while items are Assigned, Working or Returned.
Pending Review, Approved and Canceled lock uploads. Read access follows the existing scope-wide request visibility.
File signatures are checked and downloads are forced as attachments. This local version has no malware scanner and is for trusted local testing.
Server attachment deletion is not exposed. Removing a failed file from the browser retry queue does not delete an already completed server upload.
If SQL commits but its response is lost, the immutable file is retained. Interrupted/failed commits can leave unreferenced files; reconcile SQL StorageKey values before any future orphan cleanup.
SharePoint storage integration remains a later step.

## Authentication and Code Apps
The API's existing authentication mode determines the acting user. local_windows uses the Windows account running the API, not the remote browser user. A test username on the connection screen works only with development_header.
Production needs company-approved verified identity. No SQL credentials or proxy secrets belong in browser code.
src/api.ts isolates data access for future connector services. Code Apps hosts the frontend; FastAPI and SQL remain separately hosted. Company authentication/connectors are not implemented here.
Summary/PIC endpoints use parameterized reads with existing Packaging SQL authorization. They require SELECT rights; an EXECUTE-only production deployment should move these queries into approved stored procedures.

## Customer entry comparison

Open the Customers section with Customer or Admin access. It uses the same
Customer API and SQL records as Sales_Template.xlsm; no new database is needed.

- Search by customer-name prefix, market and status. Rows per page accepts 1–500.
- New customer: enter name, market and currency, then review and confirm.
  New records default to Active. Add customer section stacks another record in
  the same form (up to 500). Review and confirm sends all unsaved sections once.
  Each result is matched by RowNum. Successful sections stay locked if others
  fail; correcting and retrying sends only the failed sections.
- Edit customer: review and confirm changes. Original RowVersion is sent with
  updates; conflicts retain entered values instead of overwriting another user.
- Edit customer uses the pencil icon. The dedicated Block section is removed;
  the Status dropdown still supports Active/Block.
- An uncertain network save disables resubmission. Refresh and check the list
  before creating another record.

For comparison, create a uniquely named test customer here, refresh Customer in
Excel, update it there, then refresh this directory to see the same changes.
Use approved test data: saves from either interface update the shared database.
The existing authentication mode still determines the recorded user.

## Personal layout, appearance and export

Customer **Layout options** lets each signed-in user choose visible columns and
filters. **Save layout to profile** stores those choices, filter values and page
size in SQL. Hiding a filter clears it. Reset layout restores defaults; save again
to persist the reset. Reload profile discards local layout choices and restores
the saved profile. Profile conflicts require reloading before saving again.

**Export current page to Excel** downloads a real .xlsx containing the displayed
page and visible columns, in their current order. It is a snapshot export, not a
bulk upload template, and does not export all matching pages. IDs, RowVersion,
hidden columns and action buttons are excluded. Values are literal text, not
Excel formulas. No attachment files are included.

The Customer page has a compact heading and an icon task bar for Refresh,
Layout options and Export. Buttons have accessible names and hover tooltips.
In Layout options, use the column-order arrows to move a column left/right;
save the layout to persist its order. The Excel export uses that same order.

The sidebar menu collapses navigation to an icon rail, not an empty space.
Section icons remain clickable. The sidebar theme and navigation icons save
their changes automatically; there is no Save appearance button. If saving
fails, the previous appearance is restored and a profile error is shown.
The task bar is left aligned. The plus icon in the table header creates new
customers and sits directly above the row edit icons, including in an empty table.
Customer forms have no preview or hide-panel action. Drafts remain in memory,
not the profile; closing the browser loses them. Closing a dirty form warns first.

Deployment: apply sql/18_workbench_preferences.sql to the existing test database
and restart the API. It adds dbo.WorkbenchPreference, linked to dbo.Users.
The API SQL account needs SELECT/INSERT/UPDATE rights on this table. No new
database or Customer-data migration is needed.

Profiles use the authenticated API UserID, never a username supplied in the
settings payload. In local_windows mode all remote browsers still use the API
process account; distinct real-user profiles require verified per-user
authentication (or development_header only for controlled local tests).
Current customization/export is for Customers; appearance/navigation is shared.

## Verify
### Customer sorting

Use the Sort task-bar icon to add up to eight sort columns, choose ascending or
descending directions, and change priority. Click a column header for a single
sort; Shift-click adds or toggles that column within a multi-column sort.
Sorting resets to page 1 and is applied in SQL before pagination. Equal values
use record ID as a stable tie-breaker. Empty values sort first ascending and last
descending. Removing all rules uses record ID order.

Save layout to profile remembers sorting. Export preserves the displayed page
order. Apply sql/20_customer_sort.sql after migration 19 and restart the API.
Existing Excel callers keep Customer name ascending as their default.

Customer layout also offers Created at, Created by and Updated by. Audit users
are displayed and exported as usernames, never IDs. Audit timestamps display UTC+7 with AM/PM (for example 23 Sep 2026, 04:00 PM);
an unmodified record has no Updated at/Updated by value. Currency and Created by
filters are available under Layout options. Market/Currency choices show code
and name. Apply sql/19_customer_web_details.sql after the existing migrations;
the additional stored-procedure parameters are optional for Excel compatibility.


    npm.cmd run build
    npm.cmd test

Browser tests use installed Google Chrome and mocked API writes; no live records are created.
tests/python/packaging_workbook_api_contract.py exercises actual Packaging mutations with rolled-back SQL fixtures.
## Packaging field entry

See [Packaging field rollout](../docs/packaging-field-rollout.md) for the local webapp release, required migrations, item tabs, entry permissions and Excel compatibility notes.

## Opportunity Excel Local Update

The Opportunities toolbar downloads a combined Header / Item workbook with separate commands, blue/orange headers, required columns, filters and header-based paging. See [Opportunity Excel guide](../docs/opportunity-excel-workbench.md). Deploy `templates/Opportunity_Local_Update.xlsm` alongside the API; runtime downloads do not require Office on the server.

## Packaging Request Excel Local Update

The Packaging requests toolbar downloads a combined request/header and item workbook for response updates. Header snapshots, PIC assignment and workflow remain app-controlled. See [Packaging Excel guide](../docs/packaging-excel-workbench.md). Deploy `templates/Packaging_Request_Local_Update.xlsm` alongside the API.

## Packaging Material and Pricing Excel Local Update

Both master sections offer layout-aware C/U/Block workbooks through Excel Local Update. They share `templates/Packaging_Master_Local_Update.xlsm` and one VBA engine. See the [Packaging master Excel guide](../docs/packaging-master-excel-workbench.md).
