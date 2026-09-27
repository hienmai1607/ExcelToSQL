# Product Customer ownership

Apply SQL migrations in order through `28_product_customer.sql` to database `test`, then deploy the matching API, built webapp/dist, and templates/Product_Local_Update.xlsm.

- Customer is required for new Products and for editing legacy unassigned Products.
- The Product list, Layout and Excel Local Update include the required Customer name. The API stores CustomerID; users select the name.
- Opportunity creation offers only active Products belonging to the selected Customer. Changing Customer clears incompatible unsaved item selections.
- SQL validates new/changed item relationships, including API and Excel writes. Unrelated edits to existing historical relationships remain possible.
- A Product with an assigned Customer cannot be reassigned once used by an Opportunity. Create another Product for a different Customer.
- An Opportunity with saved items keeps its Customer in the web editor; SQL also rejects customer changes incompatible with existing items.
- Legacy Products are not automatically assigned: some existing Products were shared between Customers. Assign an owner manually in Product Edit; create separate Products where needed. Old Opportunity links are preserved.
- CustomerID remains nullable solely to retain untouched legacy Products. A database trigger enforces required Customer on subsequent Product inserts/updates. After legacy cleanup, a later migration can make the column NOT NULL.
- Download a fresh Product Excel Local Update workbook to obtain the Customer column and updated VBA.
