# Packaging fields — local webapp release

## Status

Migrations 22 and 23 are applied to local SQL Server `test`. The API workers
were reloaded without changing the supervisor's environment or authentication.
The rebuilt `webapp/dist` is served at the existing `/workbench/` URL.
No existing Product, Opportunity or Packaging Request records were backfilled,
deleted or converted.

The webapp is ready for testing. Hard-refresh the browser (Ctrl+F5).

## Where to test

- Products → New/Edit: Category, Grade and Mix ratio %. Category is mandatory
  for creation; existing products may retain a blank Category until maintained.
- Opportunity → New/Edit: Currency and Exchange rate to VND at header level.
  **1 currency unit = X VND**; VND must use 1. Existing blank header currencies
  must be filled in when editing through the webapp.
- Expand **Packaging requirements** under each Opportunity item to enter the
  thirteen new requirement fields. Maximum pallet height is meters, shelf life
  is days. Packaging type is mandatory for every item selected for a new request.
- Opportunity and Packaging Request item grids: All Fields / Product Info /
  Packaging Request / Responses. Layout controls visible and prefix columns.
  Existing saved layouts retain their choices and acquire the new field columns.
- Product Info shows Product Name and Net weight (g) as read-only values from
  Product master in both Opportunity and Packaging Request item grids.
- Select items for request creation only on the Packaging Request tab. Its
  request box is visible only on that tab with at least one item selected;
  switching tabs preserves selected items and entered request notes.
- Packaging Requests: the assigned Packaging PIC or Admin can edit responses
  in Assigned, Working or Returned. Save incomplete data, then Submit.
  Both PM types, Unit/CTN, Packaging description and both PM MOQs are required
  before manager review. Zero MOQ is distinct from blank and is accepted.
- PackagingManager/Admin can approve or return Pending Review responses.
  They can also cancel open request items. Return and cancellation require a
  reason. Existing self-approval restrictions remain enforced by SQL.

## Data ownership and safety

Product metadata is joined from Product. Requirements belong to Opportunity
Item and are read-only in the Packaging Request grid. Responses belong to each
Packaging Request Item and are read-only in Opportunity.

The Opportunity grid chooses the active request, otherwise the newest
non-cancelled request, and shows its number/stage. Packaging Request detail
always reads that request's own response, not another request's latest result.
Sales-only callers retain the existing rule: response values are visible only
after approval; Packaging roles/Admin can read work in progress.

An active request locks the Opportunity item's basic data and requirements in
SQL as well as the webapp, including updates from Excel and Admin. Approved
and Canceled requests release this processing lock; other stage restrictions
still apply. Stage/audit/no-op updates remain possible.

Original fields and additional fields are saved in the same transaction.
RowVersion is checked and the final version is returned. Opportunity changes
to new fields are included in the existing change log. No Packaging history
table is introduced. Legacy omitted fields are preserved, not cleared.

## Pending decisions and compatibility

- PM Type is text entry for now; no unapproved material lookup/master is created.
  The original requirement for both PM types and both MOQs is retained until
  the second-material rule is revised.
- PM cost is optional and new webapp entries use VND. If entered, an explicit
  cost basis is required by the existing SQL model. No basis is defaulted and
  no automatic cost conversion is performed.
- Existing non-VND response costs remain in their original currency, displayed
  alongside the cost. Editing them requires a reviewed VND amount; they are
  never silently relabeled.
- Recycled content remains text because a percentage unit has not been confirmed.
- **Excel workbook columns/VBA have not been extended in this release.** Old
  updates retain new fields, but old Product creation cannot supply the newly
  required Category. Use the webapp for new Product creation until workbook
  mappings are updated. New Packaging Requests from any client require the
  selected Opportunity items to have Packaging type.
- Original TVPs are unchanged. V2 TVPs reserve the extended workbook contract;
  current API writes use the original business procedure and an authorized,
  whitelisted additional-fields procedure in one transaction.

## Deployment

For an environment already running the current Packaging and Opportunity
change-log migrations (13–21), apply in order:

1. `sql/22_packaging_field_foundation.sql`
2. `sql/23_packaging_field_writes.sql`
3. Deploy matching `core/` and built `webapp/dist/`, then restart API workers.

Do not run older Packaging workflow or Opportunity audit migrations after
these scripts: they would replace the new validation or change-log definitions.
The legacy fresh-database company manifest is not a complete deployment recipe
for these newer Packaging/webapp features; do not use it alone for this release.
No company VM deployment was performed.

The runtime account needs EXECUTE on the additional-field procedures. Do not
grant application users direct SELECT on the internal response view or writes
on underlying tables.

## Verification

- 34 real SQL/API rollback tests: migrations, permissions, processing locks,
  required fields, transaction rollback, numeric/rate validation, response
  resolution, audit entries, final RowVersions, reads and response submission.
- Full browser suite: 60 tests passed, covering create/edit, request selection,
  attachments, response entry, tabs/layout, sorting, roles, mobile and sessions.
- TypeScript check and production build passed.
- Live read smoke checks confirmed new schemas, currency lookup, Opportunity
  fields, request responses, Product fields and the served build.

Run integration tests only on local `test`, outside active data entry:

```powershell
.\venv\Scripts\python.exe tests/python/packaging_fields_web_contract.py
```

They hold temporary schema locks and roll back schema/fixture changes.
Identity and RowVersion counters may advance even after rollback.
