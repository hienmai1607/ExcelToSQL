# Opportunity product net weight

Apply migration 82 after 81 and deploy the updated API and webapp together.

Product Info replaces Item description with read-only Net weight (g). Shared
Opportunity and Packaging Request web item layouts remove the Description column;
restoring a saved layout drops its old description columns, sorting and prefix.
Legacy descriptions and workbook contracts are retained for compatibility.
New web saves omit ItemDescription. SQL defaults it to ProductName on creation
and preserves the previous description on same-product edits.

OpportunityItem.ProductNetWeightGrams and ProductWeightSnapshotCapturedAt capture
Product Master weight on insertion, including generated mix children. Choosing a
different product recaptures its weight. Master edits, packaging copies, unrelated
item edits and migration reruns do not recapture it. The client cannot set weight.
The Opportunity grid, direct item reader and exports use this saved value.
New Packaging Requests copy the Opportunity weight; existing request snapshots
and pricing history are never rewritten.

For legacy items, migration 82 captures the latest matching non-null request weight
when available, otherwise the current Product Master weight. Existing Opportunity
rowversions change once during this backfill, so refresh open editors afterward.
No missing historical master weight is inferred.
