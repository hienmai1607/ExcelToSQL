# Category Master (migration 97)

Apply [97_product_category_master.sql](../sql/97_product_category_master.sql) after the existing 89-96 VM upgrade, in the intended application database. Back up the VM database first, then run the complete script in SSMS or SQLCMD with stop-on-error enabled. Restart the API and refresh the browser after deploying the new backend and built frontend.

The migration is additive and rerunnable. Existing nonblank Product categories are seeded as Active without changing Product rows or history. Duplicate category names are case-insensitive. Rerunning does not reactivate blocked categories.

In Shared masters > Category Master, Admins can create categories and set Active/Block status. Product users can view, filter, sort, save their layout and export the master, but cannot maintain it.

Product create/edit uses a category dropdown. Active categories can be assigned; an existing blocked or unavailable value is retained when other Product fields are edited. New Products require a category. Names already used by Products cannot be renamed: create a new category and explicitly reassign Products as needed. Categories are not deleted.

Excel Product updates continue using the existing Category text column, but new assignments must match an active master name. Unknown or blocked assignments return an actionable error and roll back the Product save.

Verification:

- `python -m unittest discover -s tests/python -p category_master*contract.py -v`
- `cd webapp; npm.cmd run build`
- `npx.cmd playwright test tests/category-master.spec.ts tests/products.spec.ts tests/product-grades.spec.ts tests/product-mix.spec.ts tests/shared-master-view.spec.ts`

SQL regression tests only run against the local `test` database and roll back their changes.
