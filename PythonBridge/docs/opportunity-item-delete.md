# Deleting Draft Opportunity items (standalone and Mix)

## Behaviour

Draft Opportunity items are deleted with the trash icon on the item row (business deletion, creator or Admin only).

- **Mix items** are deleted from the **parent** row. The whole family goes together: the parent, every child and the captured mix snapshot. Every child must also be deletable: Draft, no Packaging/Recipe Request, no processing change history, no saved TCB or PKG pricing, and not referenced by saved business data. Otherwise the delete is refused with the reason.
- **Mix children** have no trash icon. The API refuses a child on its own with "Mix children are removed with their parent item. Delete the Mix item instead."
- Every item automatically gets an empty initial TCB version (Version 1, nothing saved). It is not history and is removed with the item. A saved TCB, a second TCB version or captured context still blocks deletion.

Before this change, deleting a Draft Mix item failed with "Cannot delete: referenced by OpportunityItem". Deleting directly in SQL, or through the Excel `D` command, failed on the initial TCB version's foreign key.

## Migration 163

`sql/163_opportunity_item_delete_initial_tcb.sql` requires 162. It patches `tr_OpportunityItem_MixDelete` (marker `-- Initial TCB version (163)`) to delete the empty initial TCB versions of the deleted items and their Mix children before deleting the rows. No data is changed when it is applied, and it can be rerun. It is included in the [160–163 VM bundle](vm-upgrade-160-to-163.md).

`core/business_deletion_api.py` treats a Mix parent's children and snapshot as owned. It checks each child with the same rules, refuses child rows, and includes children in the eligibility scan. The web app (`main.tsx`) hides the trash icon on child rows.

## Deployment

Apply migration 163 (or the 160–163 bundle), deploy `core/` and `webapp/dist/` from the same commit, restart the API and hard-refresh browsers.

## Verification

- `python tests/python/opportunity_item_delete_contract.py`: rollback-only desktop tests (10). They cover Mix family and standalone deletes in SQL and through business deletion, refusal of a child, and blocking by saved TCB or a second TCB version.
- `npx.cmd playwright test tests/opportunity-item-delete.spec.ts` (in `webapp/`): the parent has a trash icon and children don't.
