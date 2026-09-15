# Transaction model

Opportunity is the reference implementation for future header/detail transactions.

## Ownership

- Excel presents one combined header/item sheet and edits Draft business data.
- The workflow application (for example PowerApps) requests stage transitions.
- SQL Server is authoritative for authorization, transition rules, concurrency,
  idempotency, and audit history.
- Excel stage columns are visible and informational, but the sheet remains
  unprotected for user interaction. Excel save payloads do not contain stage
  fields; new records receive `Draft` in SQL, so typed stage changes are ignored.

## Public interfaces

- `POST /api/opportunity/batch` saves Draft data. Each opportunity is sent to a
  separate SQL transaction, so one invalid document does not roll back another.
- `GET /api/opportunity/grid` pages headers before joining lines and supports
  number, customer, stage, and Bid Open date filters.
- `POST /api/opportunity/{opportunity_id}/stage-transition` performs a header
  workflow transition.
- `POST /api/opportunity/item/{item_id}/stage-transition` performs an item
  workflow transition and bumps the parent header RowVersion.

Transition requests require `TargetStage`, `ExpectedRowVersion`, `RequestID`,
and an optional `Reason`. Reusing a successful `RequestID` returns the original
result without applying the transition again.

## Database invariants

- Only a live `Admin` or `Opportunity` scope can save or transition.
- Excel can create or modify only Draft transactions.
- Customer and Product references must be Active.
- Header and item RowVersions protect concurrent edits.
- Closed or Canceled headers cannot accept item transitions.
- A header cannot become Closed or Canceled until it has at least one item and
  every item is Awarded, Lost, or Canceled.
- Every successful stage change is written to the corresponding history table.

## Reuse

For each future transaction, keep typed `{Entity}` and `{Entity}Item` tables and
typed validation procedures. Reuse the transaction interfaces and conventions;
do not create a generic EAV transaction table. Extract a more generic workflow
adapter only after a second transaction provides a real variation at that seam.
