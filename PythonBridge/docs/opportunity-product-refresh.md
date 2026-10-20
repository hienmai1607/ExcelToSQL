# Explicit Product weight refresh
Opportunity net weight is a captured Product Master value, not a live formula.
Unrelated edits must keep that capture; existing PCR snapshots are immutable.

For an unlocked standalone Draft item:
- Clear/reselect the same Product, or use Refresh Product weight beside Net weight.
- Preview the current lookup weight, then Review and save.
- The API sends an explicit RefreshProductWeight boolean; it never accepts a weight.
- The server reads the current Product weight and refreshes the snapshot inside the
  same document transaction, returning the latest item RowVersion.
- Open PCRs, non-Draft headers/items, captured Mix parents and Mix children cannot
  use this command. Closed PCR snapshots retain their original weights.

Apply sql/130_explicit_opportunity_weight_refresh.sql after 129. It only changes
a trigger and adds a guarded command procedure; it does not refresh existing data.
The procedure checks scope, current RowVersion, Product identity and processing
locks. Its internal session marker is restored even on failure. Ordinary direct
weight changes remain rejected by the trigger.

Packaging Summary resolves saved container plans in addition to legacy profiles,
so newer plans are not mislabeled Not configured and show their actual pallet
count. Port of Entry creation uses the existing Admin-only master, prefilled with
the current Customer and Market, without saving the Opportunity draft.
