# Packaging configuration SQL model

Status: SQL and Packaging Excel/API integration implemented; the dedicated
workflow app UI remains pending. No Packaging request history tables,
temporal tables, response revisions or event logs are introduced.

## Deployment

The Packaging migrations explicitly select the existing test database using
USE [test]. Do not create another database for project updates. Apply to test
with the existing Users,
UserAccess, Currency, Customer, Product, Opportunity and OpportunityItem model
(including Product.Status) in this order:

1. sql/13_packaging_tables_types.sql
2. sql/14_packaging_master_procedures.sql
3. sql/15_packaging_request_procedures.sql
4. sql/16_packaging_workbook.sql

Restart the API to load core/packaging_api.py, then use the updated
Packaging_Template.xlsm. The repeatable workbook updater is
scripts/update_packaging_workbook.ps1; it requires Excel closed, backs up the
workbook, imports the shared JSON/HTTP modules and installs modPackagingBridge.

The scripts were originally compiled and exercised in a separate local database.
The user's deployment target is now the existing local test database; no company
VM deployment is performed. Do not load the integration-test fixtures into test.
Run sqlcmd with -b, stopping on errors. Reapplying the scripts is supported;
they preserve existing rows and do not recreate existing TVPs. Future TVP
shape changes require an explicit versioned migration.

Migration 13 extends CK_UserAccess_Scope to include Packaging and
PackagingManager, retaining the four existing scopes. No users are granted
access automatically. Existing API schemas/Admin workbook dropdowns and
usp_UserAccess_Batch still accept only the previous scope list. Until that
integration is updated, an authenticated administrator can use
dbo.usp_Packaging_Access_Set (@Username, @UserID, @Scope, @Enabled).
It only grants/revokes the two new scopes.

These scripts do not grant database permissions. The API database principal
should have EXECUTE on the intended procedures and REFERENCES on the TVPs,
without direct table-write permission. @Username must come from the verified
API identity, never a client-controlled request body. The current
development_header authentication mode remains spoofable.

## Tables

| Table | Purpose |
| --- | --- |
| PackagingMaterial | Code/name/description/UOM, Active or Block, audit users/times and RowVersion |
| PackagingPrice | Material, currency, price basis, quantity band, date range, decimal price, status, audit users/times and RowVersion |
| PackagingConfigurationRequest | App-created request, selected Opportunity snapshot, creator/date, due date, notes, CreationKey and RowVersion |
| PackagingConfigurationRequestItem | Selected item snapshot, PIC, current stage, response fields, latest submission/review metadata and RowVersion |

RequestedBy/RequestedAt serve as the header creation audit fields. Source
RowVersions are captured at request creation. SourceChanged in the grid flags
later Opportunity/header-item changes without overwriting captured values.
Foreign keys retain the source records; physical deletion of a referenced
Opportunity/item is rejected.

Responses live on the item, with one PIC per item. Dimensions are decimal mm
(height/width required at review, length optional). Cost is decimal with explicit
currency and basis. A blank cost requires blank currency/basis; zero cost is
valid and distinct from NULL. Responses can be incomplete during editing.

Latest ReviewedBy/ReviewedAt/ManagerComment describe only the latest review.
Resubmitting clears that review metadata. Earlier changes and review cycles
cannot be reconstructed; this is intentional under the no-history requirement.
Approved/canceled rows remain in these same tables and can be searched for
reference. An Excel historical-reference sheet, if retained, reads approved
current records; it does not require a separate history table.

No PriceID is stored on a response in this version. PICs enter an explicit quoted
cost and currency/basis; master price changes never recalculate existing quotes.
Automatic price selection, exchange conversion and copied-response provenance
are outside this version. Material display codes are current master values.

## SQL interfaces

| Procedure | Contract |
| --- | --- |
| usp_PackagingMaterial_Batch | Material C/U/D, D means Block, per-row results |
| usp_PackagingPrice_Batch | Price C/U/D, D means Block, per-row results |
| usp_PackagingMaterial_Read | Search/status filters and bounded paging |
| usp_PackagingPrice_Read | Material/currency/date/quantity/status filters and bounded paging |
| usp_PackagingRequest_Create | Atomically creates a request and only the selected source items |
| usp_PackagingRequestItem_Assign | Packaging manager assigns an active Packaging PIC; expected item RowVersion required |
| usp_PackagingResponse_Batch | Atomic response-only update batch, maximum 500 rows |
| usp_PackagingRequestItem_Transition | App workflow command with expected item RowVersion |
| usp_PackagingRequest_Grid_Read | Combined rows, keyset paging by ItemID, filters and total matching count |
| usp_Packaging_Access_Set | Admin-only grant/revoke of Packaging scopes |
| usp_Packaging_Authorize | Shared live Users/UserAccess authorization check |

TVPs: PackagingMaterialBatchType, PackagingPriceBatchType,
PackagingRequestSelectionType and PackagingResponseBatchType. Their column order
is part of the interface. RowVersionB64 follows the existing naming convention
but its SQL value is binary (up to 8 bytes), not a base64 string. The API must
decode/encode base64 at the boundary.

Master batches return RowNum, Status, Message, NewID and NewRowVersion. Each row
is independently processed; successful rows can coexist with rejected rows.
Duplicate IDs in one master batch are rejected before processing.

Response batches are atomic: any stale/unauthorized/locked/invalid item rejects
the whole submitted batch. SQL throws an error and saves no rows. A successful
batch returns the same result columns. The client must display batch failure
on every affected row and retain unsaved values. The response TVP has no stage,
PIC, header or command columns: it only updates existing response values.

App mutation procedures use a SQL transaction. An error rolls back their
transaction, including any caller transaction in which they were invoked.
Callers must not combine unrelated work in that transaction.

## Authorization and stage policy

- Active Opportunity or Admin scope: create requests from Draft source records.
- Packaging: maintain materials/prices; save/submit responses assigned to that user.
- PackagingManager: assign PICs, approve, return or cancel request items.
- Admin: master maintenance, assignment, approval, return and cancellation.
  Response editing/submission requires the saved PIC assignment, even for Admin.
  PIC choices require active Packaging membership and Packaging Request Edit access.
  SQL still checks active users, required fields, valid stages and RowVersions.
- Role-derived compatibility scopes do not grant assignment/review authority.
  Managers need an explicit PackagingManager direct grant (or Admin oversight).
  See [migration 105 policy and deployment](packaging-pic-access.md).
- Opportunity, Packaging, PackagingManager and Admin can read the request grid.
  Opportunity-only readers see response values/comments only after approval.
- Packaging, PackagingManager and Admin can read master data.
- Read visibility is scope-wide, consistent with the existing project;
  department/region/customer-specific row security is not introduced.
- A non-Admin PIC cannot approve their own response, even with PackagingManager
  scope. Admin may approve directly, including their own response.

Item flow:

Assigned -> Working -> Pending Review -> Approved
Assigned/Working/Returned -> Pending Review
Pending Review -> Returned -> Working
Any nonterminal item -> Canceled (manager, reason required)

Saving a response does not change its stage. Only the app transition procedure
does that. Assigned, Working and Returned permit response editing. Pending Review,
Approved and Canceled do not. Return/cancellation require a reason. Submission and
approval validate an active material, height, width, cost, currency and basis.

The implementation uses per-item approval. Header status is derived: Open if
any item is open; Completed if all are terminal with at least one approved;
Canceled if every item is canceled. This prevents stale stored header statuses.

Creation takes a client-generated CreationKey and source header/item RowVersions.
The key is unique: repeating a successful create yields error 51122, not a second
request. Recover the existing request through the grid's CreationKey filter;
do not generate a fresh key after an ambiguous network failure. Other workflow
retries use RowVersion and must reconcile current state after a conflict;
there is no workflow-event idempotency ledger.

A filtered unique index allows only one open Packaging request per Opportunity
item. After approval/cancellation, the item can be requested again if the source
Opportunity and item are still Draft. Selection can contain 1-10,000 items
from a single Opportunity.

## Pending business policy

This SQL version does NOT lock Opportunity edits or change Opportunity stages.
The choice between locking selected source items and locking the entire
Opportunity remains unresolved. Snapshot capture and SourceChanged are
implemented, but are not a replacement for that policy. Agree the source-locking
rule before production use. Per-item approval, one PIC per item, required
height/width/material/cost and optional length are explicit initial assumptions.

Header/source snapshot and request requirements are immutable through the
supplied interfaces. Due-date changes, request amendment, bulk approval,
attachments and notifications are not implemented. Cancellation is per item.
No automatic changes are written back to Opportunity.

## Prices and numeric quality

Material codes are unique. Master D blocks; foreign keys prevent deleting
referenced records. Effective dates are inclusive. Quantity bands are half-open:
[from,to); a NULL upper bound has no limit. Active prices cannot overlap for
the same material, currency and basis in both date and quantity dimensions.
The procedure serializes checks with locks; the runtime principal must not bypass
it with direct DML. Master U supplies full business fields; NULL Status preserves
the existing status. Decimal columns avoid floating-point storage of amounts.

## 10,000-row Excel contract

Grid reads are item-based because repeated source context is self-contained.
The workbook displays one page at a time, with an editable page size of 1-500
(default 200), and supports navigating datasets of 10,000 or more items. The grid
procedure supports either PageNumber or AfterID; do not combine them. The
workbook uses page numbers for Previous/Next. TotalMatchingRows is
computed before the cursor filter. An empty result has no count row; the API
must normalize it to an empty page and appropriate count metadata.

Rows are ordered by unique ItemID on the server. Excel Table sorting/filtering
operates on complete loaded rows including hidden IDs and RowVersions. Map save
results by immutable ID, not physical worksheet position. UI sorting beyond the
loaded subset, dynamic server sort expressions and snapshot-consistent exports
are not implemented. Across multiple reads, changes to data/filter membership
can alter the result set; RowVersion protects writes, not multi-page snapshots.

Fetch into a staging buffer before replacing the worklist; never silently
discard unsaved changes. Confirm changed rows hidden by filters. Do not send
all 10,000 rows on Save: send changed rows in at most 500-row batches. Separate
batches may succeed independently, so retain per-batch results.

## Workbook and API

All five data sheets have table headers on row 1, with no three-row preamble.
Controls are BA1:BD1: Save, Refresh, Previous, Next. Gap columns are hidden so
the controls appear immediately beside the table. BB4 is rows/page, BB5 is page,
BB6 is total matching, BB7 is loaded count and BB8 is a prefix filter
(Material code/name or Opportunity number; Price has no search filter).
Table sorting/filtering applies to the loaded page. Save includes changed rows
hidden by local filters and asks for confirmation. Changing size/filter resets
to page 1. An empty out-of-range page preserves the displayed page.

Packaging Material and Price accept C/U/D commands. Packaging Request accepts U
for assigned PIC responses. Packaging History is an approved-record reference
view of the same request tables; its Save button explains that it is read-only.
No worksheet protection is imposed.

Manual Request is the testing substitute for app request creation:

1. Refresh eligible existing Draft Opportunity headers and items.
2. Mark selected rows C. Enter Response Due on every selected row.
3. Use identical Response Due and Request Notes on rows of the same Opportunity.
   Packaging Requirement may vary by item.
4. Save creates one request per selected Opportunity with only the selected items.
5. Refresh Packaging Request. Assign a PIC via the manager API before responding.

Manual Request does not create Opportunities or accept fabricated source IDs.
Editing displayed source names/descriptions does not edit the source records.
An existing active request excludes that source item from Manual Refresh.
Hidden creation keys are saved to the workbook before posting. A retry with
the same key and payload returns the original request; a changed payload conflicts.
After an uncertain failure, retry without editing the selection or clearing keys.

Endpoints under /api/packaging:

- GET material, price, requests, manual: page/page_size reads.
- GET lookups: material/currency code-to-ID lookup.
- POST material/batch, price/batch, response/batch: bounded typed writes.
- POST manual: create a linked request from the selected source items.
- POST items/{id}/assign: manager assigns PIC with ExpectedRowVersion.
- POST items/{id}/transition: app/Swagger workflow command.

The SQL helper procedures added in migration 16 provide Manual source paging,
authorized master lookups and requester-specific creation-key replay.
SQL types remain the internal batch contract; the API loads TVPs through
parameterized OPENJSON to preserve nullable values without ODBC sentinels.

## Validation

tests/python/packaging_sql_contract.py records the earlier isolated integration
test. It refuses to run against the application database and retains fixtures.
Do not create another database or run this fixture suite as part of normal
project updates. Migrations 13-15 now explicitly target test, so they must not
be reused for isolated testing without intentionally changing that target.
Verify deployment in test through read-only schema checks; do not run the fresh
baseline or the 10,000-row fixture suite there.

Current workbook verification:

- tests/workbook/packaging_contract.ps1 opens Excel read-only and discards its
  in-memory fixtures. It checks buttons, headers, page size, empty rendering,
  NULL numerics, formula-like text and hidden IDs/RowVersions after sorting.
- tests/python/packaging_workbook_api_contract.py uses test within a transaction
  and rolls back every temporary record. It tests the real API/SQL path,
  permissions, paging, manual selection/create/replay and nullable responses.
  It creates no database. Identity/rowversion counters may advance on rollback.

Contracts cover unknown/inactive users, scope separation, access assignment,
master C/U/D, optimistic concurrency, price overlap, selected-item creation,
duplicate/retried creation, ownership, NULL vs zero, review locks, self-approval,
Sales visibility, source snapshots, header completion, simultaneous creation,
and paging 10,000 items. These do not benchmark Excel/network performance or
prove throughput for hundreds of concurrent users.
