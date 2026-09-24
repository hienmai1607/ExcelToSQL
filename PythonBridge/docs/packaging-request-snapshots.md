# Packaging Request source snapshots

Migration 25 (`sql/25_packaging_request_snapshots.sql`) extends existing request snapshots in database `test`. Apply after migration 24, then restart API workers and deploy the rebuilt webapp.

## New requests

The audited request-creation procedure copies Product name/code, net weight in grams, category, grade, mix ratio; Opportunity item description, units, estimated award, shelf price and all packaging requirements. Existing request-specific PackagingRequirement text is retained.

The header captures Opportunity currency ID/code and exchange rate to VND. A missing source currency/rate stays NULL; no rate is guessed. Request/header IDs, item IDs, source RowVersions, product RowVersion, requested user/date and snapshot time retain traceability.

Permissions, row-version checks and active-request exclusion are unchanged. Copying takes place inside the same SQL transaction and source locks as request creation. Existing CreationKey replay returns the original request; it does not refresh snapshots.

## Editing

Saved request specifications are immutable, including for Admin. PIC assignment, response fields and workflow metadata remain maintainable through existing authorized actions. For revised specifications, cancel the affected request item, edit its Opportunity source if allowed, and create a new request.

Request grids use the saved Product and requirement fields, not current joined source values. Product changes do not rewrite previous requests. Opportunity screens continue showing current Opportunity/Product values.

## Existing requests

Only the newly added fields are backfilled from current sources. Previously captured names/descriptions/units are preserved. Both header and items are marked `SnapshotOrigin=Migration`, with the actual capture time, and the UI explains that original values for the added fields are unavailable. New requests are marked `Request`.

Backfill is logged as System activity under the deployment SQL identity. Reapplying migration 25 does not recapture existing snapshots. It changes request RowVersions on initial backfill: refresh before editing any open screens or Excel sheets.

## Operations

- No new database, no deletion of business rows.
- Apply in a maintenance window using sqlcmd -b; backfill and additional audit entries can be sizable for large installations.
- Migration 25 updates the internal audited creation implementation; it preserves the public identity wrapper.
- Do not reapply migrations 15, 23 or 24 over this deployment: older definitions can remove snapshot capture or audit fields.
- Direct SQL table writes are not a supported request-creation interface. Runtime accounts should have only the required procedure execution permissions.
- Tests: `tests/python/packaging_snapshots_contract.py` uses rollback-only local SQL fixtures. Web response tests check snapshot provenance while preserving response editing.
