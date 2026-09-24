# Packaging Request changes log

Open a Packaging Request and select the history icon beside Close/Refresh. The shared Opportunity-style popup lists timestamp (UTC+7, AM/PM), changed by, source, header/item, item/product, action, field, old value, new value, and reason. Filter by level, source and field; choose 1–500 rows per page.

## Coverage

- Request header snapshots, due date and notes.
- Item snapshots, requirements, PIC assignment, response fields, submission/review metadata and stage.
- Derived request status (Open, Completed, Canceled) is recorded as a System change when its value changes. IsOpen follows the item stage automatically.
- Database triggers cover API, Excel and direct SQL writes; no-op updates are excluded. NULL, zero and empty text remain distinct.
- User actions carry the authenticated username through SQL procedure wrappers. Direct SQL writes without audit context use the original database login and Database source.
- Changes and business writes share a transaction: rejected or rolled-back writes leave no change entries.
- Logs retain snapshots when items are deleted. Technical RowVersion, source RowVersion and update bookkeeping are excluded.
- Migration 25 adds request-time Product/Opportunity snapshots to this log. Later changes in the source entities do not update the request snapshot. Attachment events are not included.
- Logging starts when migration 24 is applied; earlier changes cannot be reconstructed.

## Access

Admin, Packaging and PackagingManager see full request history. Opportunity users can read shared request, assignment and stage history. Historical response fields and review reasons are not exposed to Sales: those may contain unpublished drafts even after eventual approval. Normal approved-response views remain unchanged.

## Deployment

Apply `sql/24_packaging_request_change_log.sql` to the existing `test` database after migrations 13–23, using `sqlcmd -b` (stop on errors). Do not create a new database.

The migration preserves the installed write procedures behind identity-scoped wrappers. Re-running 24 is supported. Do not subsequently reapply older procedure definitions over these wrappers; future procedure changes must update their audited implementation deliberately.

Restart API workers and deploy the rebuilt webapp/dist. API: `GET /api/packaging/requests/{request_id}/changes`.

The runtime SQL account should have EXECUTE permission on public application procedures, not direct write access to business/audit tables or the internal audit implementations. UPDATE/DELETE on the log is denied to public; database administrators can still bypass permissions. This is application history, not a tamper-proof compliance archive.

The older company fresh-database manifest is not a complete Packaging deployment recipe; this migration is an incremental deployment.

## Checks

- `tests/python/packaging_changes_contract.py`: API paging, filters, scope rejection, missing migration.
- `tests/python/packaging_changes_sql_contract.py`: rollback-only local SQL tests, attribution, null/zero, no-op, delete retention, status aggregation, privacy and context restoration.
- `webapp/tests/packaging-changes.spec.ts`: history dialog, filtering, paging, mobile and close.
