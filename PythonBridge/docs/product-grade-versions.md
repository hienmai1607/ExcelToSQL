# Product codes and Grade versions

Products now receive a server-generated code such as `PRD-0000000001`.
Existing codes are preserved. Codes cannot be edited. Sequence numbers can have
gaps after a rejected save or a SQL restart; they are identifiers, not counts.

## Entry

1. In Products, choose New product and enter name, category and weight.
2. Select the Grade icon for that record section.
3. Level 1 uses Parent ID `0` for the Product. Add grades; IDs are assigned
   within that parent (1, 2, 3, ...).
4. All levels are shown together by default, grouped by parent with a separate
   ratio total for each group. Use the plus icon beside a grade to add children;
   use the plus icon in a group header to add siblings. You can edit any level
   directly. Choose By level for the Previous/Next navigation option; switching
   views retains all entries.
5. Each parent that has children must total exactly 100%. Grades without
   children are leaves and need no extra level. Ratios must be positive,
   with at most two decimals. A version supports up to 1,000 nodes and 12 levels.
6. Choose Draft or Active, then Use grades. Saving the Product saves its
   initial Grade version in the same transaction. Grades are optional at
   Product creation; they can be added later.
7. For an existing Product, select its Grade icon in the list. Select a version
   to view it. Draft versions can be edited and activated.
8. Active and Inactive versions are retained as read-only structures.
   New version copies the selected structure into a new Draft for revision.
   Select Active and confirm Save to activate it. The previous active version
   becomes Inactive automatically.

The ID is local to its parent. For example, `0/1/1` and `0/2/1` are different
nodes. Deleting a parent also removes its descendants after confirmation.
The 100% rule applies to every sibling group, not the sum of all rows or
the sum of an entire depth.

## Database and permissions

- `dbo.ProductGradeVersion`: ID, ProductID, Version, Status, audit users/times,
  RowVersion.
- `dbo.ProductGradeItem`: VersionID, ParentID, ID, Grade, RatioPct, computed NodePath.
- `dbo.usp_ProductGrade_Read` / `dbo.usp_ProductGrade_Save`: live Product/Admin
  scope checks, validated tree, version concurrency and activation.
- A unique filtered index permits at most one Active version per Product.
  Product-row locking serializes version allocation and activation.
- Both Product and Grade version RowVersions guard saves. A conflicting save
  keeps browser edits for review; reload before retrying.
- The original Product Grade/MixRatioPct storage remains for compatibility
  with existing Opportunity reads and Packaging request snapshots.
  It is no longer part of editable Product master fields. No legacy ratio is
  invented or expanded into a hierarchy automatically.
- Existing Opportunity/Packaging snapshots are not rewritten by Grade edits.
  Connecting their grade display to a specific new Grade version is separate
  from this Product-master release.

## Excel

Download a fresh Product Excel Local Update workbook. Product code is
display-only; the generated code is returned on Save. Grade/Mix ratio columns
are removed from new downloads. Maintain versioned trees in the webapp.
Old saved layouts automatically discard the retired columns/sort rules.
Older static Product templates may still prompt for manual codes; use the
new web download for this model.

## Incremental deployment

Apply `sql/27_product_grade_versions.sql` after migrations through 26 to
the existing `test` database. Deploy matching `core/`, built `webapp/dist/`,
and `templates/Product_Local_Update.xlsm`, then restart API workers.
The runtime SQL principal needs EXECUTE on both new Grade procedures and
the existing Product procedures. Avoid direct table-write grants.

Do not reapply migration 11, 23 or 26 afterward: they contain the previous
Product write rules. The old fresh-database manifest is not a complete
upgrade recipe for this release.

Use the local rollback test suite with:
```powershell
python tests/python/product_grades_contract.py --sql
```
This applies the migration and fixtures inside test transactions and rolls them
back. Identity/sequence counters may advance. The browser tests are in
`webapp/tests/product-grades.spec.ts`.

## Tree-only grade interface

Product Grade entry uses the horizontal tree for root/child creation, name and ratio edits, and confirmed branch removal. All levels and By level selectors are removed. Active and inactive versions remain read-only; use New version to revise. Existing per-parent 100% validation and save confirmation still apply.

For Product Mix, the Grade tab shows a separate read-only tree for each child Product in the selected saved mix version, using that child's current active grade version. Grade maintenance remains on the child Product.
