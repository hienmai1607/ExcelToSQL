# Opportunity change log

Open an Opportunity and select the clock/history icon beside the item toolbar.
The read-only log combines Header and Item changes. It shows time in UTC+7 (AM/PM), user,
source, item, action, field, old/new values and the workflow reason where supplied.
Filter by level, source or field; choose 1–500 rows per page. Latest changes appear
first. NULL is shown as “(blank)” and remains distinct from zero or empty text.
Customer and Product values include the name/code snapshot and ID.

## Deployment

Apply sql/21_opportunity_change_log.sql to the existing test database after
Opportunity migration 12, using a deployment account. No database is created.
Restart the API and deploy the rebuilt webapp/dist directory.
Grant the runtime account EXECUTE on dbo.usp_OpportunityChangeLog_Read.
Keep its existing EXECUTE permissions on the three public Opportunity save/stage
procedures. Do not grant callers direct access to the *_AuditImplementation
procedures or UPDATE/DELETE permission on dbo.OpportunityChangeLog.

Migration 21 snapshots the currently deployed public procedure implementations
once, then installs wrappers that scope the audit identity and restore SQL
session context on success and failure. Re-running migration 21 is supported.
After installation, future business-procedure changes must update the matching
*_AuditImplementation procedure; do not reapply older migrations over the public
wrappers. Existing business transactions, concurrency and transition replay
behavior remain inside those implementations.

## Capture and system jobs

AFTER triggers record inserts, deletes and actual field changes in the same SQL
transaction as the data. Rollback also rolls back history. RowVersion and audit
timestamp-only updates do not create noise. Field snapshots have no foreign key
to the live document/item, so deletion does not remove the history.
Logging starts at migration installation; pre-existing records are not presented
as newly created and earlier field history is not fabricated. The existing
stage-history tables remain in use for transition idempotency.

The public procedures set the validated application username and source User.
Nested trigger changes are labeled System and retain the initiating username.
Direct SQL without an audit context is labeled Database with ORIGINAL_LOGIN(),
never attributed to a stale UpdatedBy value. History is a business audit trail;
database administrators can modify database objects and must be controlled by
normal SQL permissions and operational auditing.

For future automated jobs, use a dedicated authorized SQL identity and set
OpportunityChangeSource to System, OpportunityChangeUser to the job/actor name,
OpportunityChangeEvent to a uniqueidentifier, and OpportunityChangeReason to the
rule description using sp_set_session_context. Always restore or clear these four
keys in TRY/CATCH before returning a pooled connection. Existing public transition
endpoints represent user actions and explicitly set User. Automated workflows
should scope System inside their own trusted procedure.
No new automatic transition rules are introduced by this feature.

Each SQL statement has an event ID; all changes within a public batch share an
event, and transition events use the existing workflow request ID. The API checks
Opportunity/Admin access and the read procedure rechecks live SQL permissions.

## Verification

tests/sql/opportunity_change_log_contract.sql uses temporary test records inside
a rolled-back transaction in test (identity/rowversion counters can advance).
It covers creation, actual changes, no-ops, null/zero, source and actor, workflow
replay, public batch updates, deletion, paging and rollback.
Python route contracts and the browser log test cover authorization, validation,
filters, pagination and display.
