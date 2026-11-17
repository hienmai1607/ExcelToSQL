# Mix product maintenance and "Update to current mix version"

A saved Opportunity Mix item captures its Product's Active mix version (snapshot). Activating a newer mix version in Product Master never changes existing Opportunities by itself. This feature adds two explicit steps.

## 1. Edit the Mix product from the Opportunity line

On a saved Mix item, the pencil beside Product opens the side **Edit product** popup for the parent Mix Product (the same view as New product). It is available to users with Product edit access (Product or Admin scope and the Products page); Sales-only users do not see it.

- Product fields can be edited as usual.
- Tick **Create a new mix version** to show the **Product Mix children** section, prefilled from the current Active version. Choose child Products and quantities, add a row with **+**, or create a child with **New child Product** (a normal Product for the same Customer). Set **New version status** to Active or Draft.
- **Review & save** saves the Product fields and the new mix version in one transaction (`MixVersion` on a Product update, saved by `usp_ProductMix_Save`). Leaving the box unticked never changes the mix.
- Saving reloads the Opportunity's product choices, so a newly Active version is detected immediately (see step 2). Existing Opportunities keep their captured mix until updated.
- **Product structure** on the Products page also offers **Create new child Product** on a draft version.

## 2. Update to current mix version

When the Mix Product's Active version differs from the item's captured version, the item shows **"The Mix Product has a newer Active version"** with **Update to current mix version**.

- The preview lists the children that are **kept** (same Product, own information retained, quantity changes shown), **added** (start blank; use the item copy icon to fill them) and **removed**.
- **Update on save** marks the item. The update runs when the Opportunity is reviewed and saved, in the same transaction. **Cancel update** removes the mark.
- Kept children keep their row, Packaging requirements, Others info and grades; their quantity and annual units follow the new version. Removed children are deleted. New children are created with the parent's annual units × quantity. Child numbers follow Product code order. The parent net weight recalculates from its children.
- The Opportunity change log records `MixVersion` old → new.

### When it is refused

The save is refused and nothing changes when:

- the header or any item of the Mix family is not Draft, or any of them has an open Packaging or Recipe Request (the button is disabled for locked lines);
- the item already uses the Active version, or the Product has no Active version or contains a blocked child;
- a child that would be removed has Packaging Request, Recipe Request, saved TCB, stage or PKG pricing history. The automatic initial TCB version is not history and is removed with the child, as in business deletion. In that case, add a new Opportunity item with the Mix instead.

## Database (migration 162)

`sql/162_opportunity_mix_version_refresh.sql` requires 161. It:

- patches `tr_OpportunityItem_MixDelete` and `tr_OpportunityItem_MixChildren` so a child may be removed, or have its quantity and number changed, **only** while `usp_OpportunityItem_MixRefresh` runs for that parent (session key `OpportunityMixRefreshID`). Direct edits remain blocked, and children must still match the snapshot;
- adds `usp_OpportunityItem_MixRefresh`, callable only inside the Opportunity save transaction, with Opportunity/Admin access and the parent RowVersion.

The API accepts `RefreshMixVersion: true` on a saved Mix parent item row in `/api/opportunity/batch`. It is rejected on child rows and new items.

## Verification

- `python tests/python/opportunity_mix_refresh_contract.py`: rollback-only desktop tests covering keep/add/remove, refusals, direct-edit protection and the real batch save with parent weight recalculation.
- `webapp/tests/opportunity-mix-update.spec.ts`: preview, save payload, cancel, Product-user pencil and Sales-only view.

Deployment: apply migration 162 (included in the 160–163 VM bundle), deploy `core/` and `webapp/dist/`, then restart the API. Deleting a whole Draft Mix item is covered in [Opportunity item deletion](opportunity-item-delete.md) (migration 163).
