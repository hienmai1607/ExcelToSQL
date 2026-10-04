# Product shelf life and packaging field scope

Product Master owns optional Shelf life (days): whole days from 0 to
2,147,483,647. Blank means not maintained. Product and Admin roles may maintain
it through web forms or a fresh Product Local Update workbook.

Opportunity parent and child rows show the selected Product's current shelf life
read-only. No shelf-life override is accepted in Opportunity web/API/Excel.
New Packaging Requests capture Product shelf life and Product RowVersion;
later Product edits do not change existing request snapshots.

Pallet size, Pallet stacking, Max pallet height and Container request apply only
to root Opportunity items (mix parents and standalone Products). Child input
controls are removed. Both the API and SQL reject these keys on child edits,
including NULL values. New child request snapshots leave these fields blank.

Barrier requirement is retired for all items. Current forms, layouts and exports
omit it. Old saved layouts have its column, sorting and width settings removed.
Legacy storage columns remain intact; existing Opportunity values and immutable
request snapshots are not deleted or rewritten. Legacy child logistics are
hidden from current Opportunity and request views. Shelf life starts blank in Product Master;
old item-specific values are not copied because one Product may have conflicting
values across Opportunities.

## VM deployment

1. Back up the database and run SQL 48 after 47.
2. Deploy matching core files and the full rebuilt webapp/dist directory.
3. Deploy both templates: Product_Local_Update.xlsm and Opportunity_Local_Update.xlsm.
4. Restart the API, refresh the browser and download fresh local-update workbooks.

SQL 48 is rerunnable and runs its schema/procedure changes in one transaction.
