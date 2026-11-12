# Opportunity Estimate Delivery Date

The optional Estimate Delivery Date is maintained once per Opportunity, immediately after Bid close. The desktop header stays on one line at 1440 and 1920 pixels. Item Recipe requirements retain Special comments; their date input is removed.

New Recipe Requests capture the Opportunity header date. Existing Recipe Requests and Recipe Sheets retain their original captured date, now labelled Estimate Delivery Date. Editing the header does not change existing captures.

Migration 158 adds the header date, updates the atomic additional-fields save procedure and includes the field in header change history. On first installation, a single distinct legacy item date is carried forward; conflicting dates leave the header blank for review. Rerunning the migration does not overwrite header dates.

VM deployment after migration 157:

1. Back up the database and stop API workers.
2. Run `sql/158_opportunity_estimate_delivery_date.sql` against the application database.
3. Copy the updated `core/` and `webapp/dist/` folders.
4. Restart API workers and refresh the browser with Ctrl+F5.

Migration 158 has been applied to the desktop test database. Focused browser checks cover header placement and submitted payloads; rollback SQL/API checks cover saving, clearing, change history, migration reruns, conflicting legacy dates and request snapshot retention.
