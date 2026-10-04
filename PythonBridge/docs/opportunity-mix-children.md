# Opportunity Product Mix children

Selecting a Product Mix previews its Active version beneath an expandable parent.
Children are numbered 3.1, 3.2, and so on; root items keep their normal numbering.
Sorting reorders roots without detaching their children.

On save, SQL creates an immutable OpportunityMixSnapshot and real child
OpportunityItem records. Each child stores its parent ID, component multiplier,
and sibling number. Activating a different Product Mix version later does not
change existing Opportunity compositions or quantities.

Child Annual units = parent Annual units x saved component quantity, calculated
using decimal arithmetic with four decimal places. Parent quantities remain
whole numbers. Product identity, description, membership and child quantities
are read-only. Estimated award and Shelf price apply only to the parent.

Each child has independent Packaging requirements, editable in Edit Opportunity
and the Opportunity Local Update workbook. The API and SQL reject child identity
or quantity changes. Existing child edits require their current RowVersions;
the parent and any child edits share one document transaction.

Both parents and children can be selected for Packaging Requests, independently.
Each gets its own request item, processing lock, response and request-time
snapshot. An open parent request does not lock an unrequested child. Parent
quantity changes are refused while any child has an open request or is not Draft.
Deleting an unrequested parent removes its children atomically; existing request
and workflow-history references continue to prevent destructive deletions.

Migration 47 backfills current compositions only for Draft mix items in Draft
Opportunities that have never had a Packaging Request. Those snapshots have
Origin = Migration; they are not represented as historical compositions.
Previously requested or non-Draft legacy mix rows remain unchanged.

## Deployment

1. Back up the VM database, then run sql/47_opportunity_mix_children.sql after 46.
2. Deploy matching core/ files, including new opportunity_mix.py.
3. Deploy the complete rebuilt webapp/dist/ and templates/Opportunity_Local_Update.xlsm.
4. Restart the API and refresh the browser. Download a fresh Opportunity workbook.

The migration is rerunnable. It replaces per-Opportunity product uniqueness with
per-root/per-parent uniqueness and expands Opportunity/request AnnualUnit columns
to DECIMAL(18,4). Legacy parent TVPs stay integer-based; child requirement edits
use the existing guarded field procedure.

Packaging Request creation now uses a typed JSON-to-TVP SQL adapter from migration
47. The existing request procedure retains authorization, concurrency checks,
idempotency, and snapshot rules. This avoids the ODBC metadata-discovery failure
observed with a DECLARE-TVP batch in rollback integration tests.
