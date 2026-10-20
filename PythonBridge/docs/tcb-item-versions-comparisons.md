# Per-item TCB approaches

Apply `sql/136_tcb_item_versions.sql` after 135 and restart the API with the rebuilt web app.

Each Opportunity item has one active version. Existing live TCB settings and grade snapshots become Version 1, without modifying those settings. A filtered unique index prevents two active versions. The migration is repeatable and does not overwrite an item's versions.

## Editing and activation

- The per-item Version selector opens a saved approach. New version accepts a name and either a blank approach or a copy of another saved version belonging to this item.
- New versions are inactive. Saving inactive recipes, raw prices, grades or loss settings does not update OpportunityItem or its captured Packaging Request.
- Set active is explicit. It revalidates current raw quotes, loss assignments, Draft stages, item/version rowversions and Packaging Request grade locks. It publishes through the existing item/TCB procedures and switches the active flag in the same transaction.
- Active edits and legacy TCB/grade writers synchronize the active version. Earlier inactive approaches retain their own inputs, quote captures and analysis context.
- Inactive grade exploration is allowed even with an open Packaging Request, but activation of a changed grade tree remains blocked while that request owns the live grade snapshot.
- Captured net weight is used for an inactive approach's formula variables. Activation recalculates against live item inputs.
- Creating, saving and activating are recorded in OpportunityChangeLog. There is no silent deletion of named approaches. The automatically created empty initial version does not block deletion of an otherwise unused item.
- Up to 100 versions per item. Closed or non-Draft items support read-only inspection and comparisons, not edits.

## Header actions

1. Compare TCB versions: columns for saved versions, highlighting the active approach. Mix versions show their smallest child-unit impacts.
2. Analysis: all items in the current Opportunity, even if only one item was initially opened. Current editor drafts are retained; other items use saved settings.
3. Compare opportunity items: the current item's saved active approach opens first, highlighted and not removable, even when an inactive approach or unsaved edits are open. Search authorized Opportunities by number, product or customer and append item columns to its right. Only added columns have Close. The current item cannot be added again; re-adding another item refreshes its column without duplicating it. This is read-only.

Comparisons preserve each column's own Sales container and customer currency; Packaging Response options are references, not an automatic Sales container selection. Historical versions use stored quote precision and captured context, not a newly rounded price. Missing required inputs are shown as Incomplete.

Analysis labels omit repeated ($/unit); column headings retain the per-smallest-product-unit explanation. FOB is one row showing USD / customer currency, with no duplicate when customer currency is already USD. Underlying calculation rows and exact rational arithmetic remain unchanged.

## Creation/save regression

The version INSERT is followed by an identity SELECT. With the driver's normal NOCOUNT OFF setting, an insert row-count result arrives first. Calling fetchval immediately raised "No results. Previous SQL was not a query." and rolled back creation. Creation now consumes all result sets and takes the explicitly named TCBVersionID result; it does not depend on connection-level NOCOUNT settings. Regression coverage enables row counts explicitly.

New version uses a compact, content-height dialog with Name, Copy from and Cancel/Save actions. Creation errors remain inside the open dialog, retaining values for retry. Desktop and mobile checks guard against full-screen record-layout inheritance.

## Coverage

Current-schema rollback-only tests: `tcb_versions_contract.TCBVersions`.
UI coverage: `tcb-versions.spec.ts`, `tcb.spec.ts`, `tcb-analysis-model.spec.ts`.
Tests cover isolated alternative saves, copying, activation, one-active uniqueness, stale writes, permissions, grade locks, legacy synchronization, comparisons, column removal, dual-currency FOB, and discarded-switch protection.
