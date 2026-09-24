# Packaging Request Excel Local Update

In **Packaging requests**, choose **Excel Local Update** to download Packaging_Request_Local_Update.xlsm. It follows both saved layouts, current filters, sort and page. This does not change the existing Packaging_Template.xlsm.

## Combined header and item sheet

Each row repeats request header information followed by one request item.

- Blue headers: request header information, labeled **[display]**.
- Gray item headers: immutable Product/Opportunity snapshots, PIC, stage and other display-only values.
- Light orange headers: editable response fields.
- Darker orange **\* review**: fields required before submitting for manager review. They can remain blank when saving an incomplete response.
- **Item Command** appears immediately before the item fields. Use N/blank or U. Changed response values are detected automatically.
- **Response access** shows whether the downloading/refreshing user can edit that response. The API and SQL recheck permissions at Save time.

There is no Header Command: request creation, header/source changes, PIC assignment, submission, approval, return and cancellation remain in the app. Excel does not create or delete request items.

## Permissions and workflow

- Packaging users can update only their assigned responses in Assigned, Working or Returned stage.
- Admin can update responses in those editable stages regardless of PIC.
- PackagingManager alone can read the workbook but cannot maintain responses unless also authorized as the assigned Packaging PIC.
- Opportunity/Sales users can download for reference. Unapproved response values remain hidden by the existing read policy.
- Pending Review, Approved and Canceled items are not editable.
- Use the app to submit, approve, return, cancel, assign PICs and manage attachments.

## Save

Enter response values, then click **Save** on Controls and confirm the shared Save dialog.

Editable columns cover PM types, Unit / CTN, packaging description, MOQs, pallet/carton configuration, dimensions, PM cost, cost currency, cost basis and response notes. Blank optional numbers remain null, not zero.

PM cost requires a valid currency code and cost basis. Currency is not converted automatically. Omitted/hidden fields retain their existing values; Product and Opportunity data come from the stored request snapshot.

Each item saves atomically using the existing response procedure and change-log path. Separate items can succeed/fail independently. Review Result and Message after saving; failed entries remain for correction. Refresh to load the latest stage/status.

A stale RowVersion or changed PIC/stage is rejected. An unknown/lost Save response blocks another Save until Refresh and reconciliation. Maximum 500 changed response items per Save.

## Layout and pagination

Required identity columns and the six pre-review fields cannot be unchecked in web Layout and are always included in downloads. Optional response columns can be selected and reordered through Layout.

Controls provides Save, Refresh, Filter, Previous and Next. Enter 1–500 **requests per page**. All items for a request stay together; the flattened worksheet can contain more rows than the page size. A page may contain at most 10,000 item rows; reduce page size if it exceeds that limit.

Search matches request, Opportunity or Customer prefixes. Status accepts blank, Open, Completed or Canceled. Refresh confirms before discarding unsaved edits.

Do not remove the hidden key row, IDs, original snapshots or RowVersions. When sorting in Excel, include the complete row range, including hidden columns. The sheet is unprotected: native Hide is possible, but Save/Refresh restores required columns.

Requested-at timestamps use UTC+7 with AM/PM. Excel numeric cells have precision limits; retain text-formatted exact decimal inputs for high-precision values.

## Deployment and checks

Deploy templates/Packaging_Request_Local_Update.xlsm with the updated API and rebuilt webapp/dist. Existing Packaging migrations/procedures remain prerequisites; this feature adds no new database tables or procedures. Runtime downloads do not require Excel on the API server.

Set EXCEL_API_BASE_URL if users reach the API through a different URL. Workbooks use the Excel user's identity, not the browser exporter's identity. Development headers are for trusted testing only.

Rebuild on an approved developer workstation:
powershell -File scripts/build_packaging_request_local_template.ps1

Re-sign/reapprove the VBA artifact under company policy. Download a fresh workbook after a macro update.

Verification:
- tests/python/packaging_excel_contract.py
- tests/python/packaging_excel_sql_contract.py (local SQL test fixtures rolled back)
- webapp/tests/packaging-excel.spec.ts
- scripts/packaging_excel_smoke.py and scripts/test_packaging_request_local_template.ps1
