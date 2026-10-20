# Opportunity net weight and copying Product grades

Migration 135 adds an authorized item-weight command. It reuses the captured OpportunityItem.ProductNetWeightGrams column. There is no business-data backfill.

Opportunity editing:
- Product selection defaults net weight from Master. Existing saved captures are not silently refreshed.
- A positive gram weight, with at most two decimals, can be overridden per editable item.
- The refresh icon reloads current Product Master weight into the draft. Changes persist only with Opportunity confirmation.
- API field NetWeightGrams is optional; omitting it preserves the captured value. RefreshProductWeight is a mutually exclusive command.
- The document transaction applies overrides for normal lines and Mix children, including newly captured Mix children. Draft state, row versions, active refresh sources and open-request locks remain enforced.
- Changes update audit metadata and append a WeightGrams change entry. No Product Master or existing Packaging Request snapshot is rewritten.

Copy grades:
- Copy grades appears in the Product grades header, including new Product drafts and editable Opportunity snapshots.
- Only active, non-Mix Products with nonempty active grade versions appear as sources.
- Copies paths, names, ratios and Raw Grade/Material links, not source version IDs or status.
- Existing content replacement requires confirmation. Loading failure or cancel preserves the target draft.
- Active/Inactive target versions remain immutable; create a new version first.
- Source reads require Product or Opportunity access and respect workspace read access. Copying performs no server writes; the target is saved through its usual confirmation.

Focused tests: editable_opportunity_weight_contract, copy_grades_contract, product-grades.spec.ts, opportunity-create.spec.ts, opportunity-edit.spec.ts.
