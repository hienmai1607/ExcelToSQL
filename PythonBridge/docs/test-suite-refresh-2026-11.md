# Test suite refresh and two UI fixes (November 2026)

Many contracts and browser specs failed on a clean checkout, so real regressions could not be seen. They were gone through one by one. Each failure was either an **out-of-date test** (the product had changed on purpose and the test was never updated), now aligned with the documented behaviour, or a **real bug**, now fixed.

No SQL migration is required for this page. The Mix item deletion fix has its own migration 163, described in [Opportunity item deletion](opportunity-item-delete.md).

## Bugs fixed

| Area | Problem | Fix |
| --- | --- | --- |
| Packaging response actions (`item-review-actions.tsx`) | **Submit** appeared for Admin on an item with no PIC (clicking it only raised "Assign PIC before submitting"). It also appeared for a manager on an item already **Pending Review**. | Submit now requires an assigned PIC and an item still in Assigned, Working or Returned, consistent with Cancel. |
| Full Playwright run (`item-view-fields.ts`) | `npx playwright test` with no file filter stopped before running anything. `item-view-fields.ts` imported `costSections` through the `shipment-sections.tsx` component, which pulls in CSS that Playwright's loader can't parse. | It imports from the plain-data `shipment-model.ts`. |
| Wide dialogs (`pkg-pricing.css`, `opportunity-losses.css`, `tcb-calculator.css`, `product-grades.css`, `packaging-summary.css`) | The Pricing Calculator (and potentially TCB, Loss, Grades and Packaging Summary dialogs) could be capped at 500px wide: the generic `.dialog { max-width: 500px }` loads later in the bundle and won by import order. Pricing component cards then stacked instead of sitting side by side. | Width rules are written as `.dialog.<name>`, so they no longer depend on CSS import order. |

## Tests aligned with current behaviour

| Test | Current behaviour it now checks |
| --- | --- |
| `npd_recipe_contract`, `recipe_scope_contract` | Recipe Info always contains a Seasoning component (86b816a). On an excluded grade it has ratio 0 and no price. |
| `mix_child_others_contract` | Mix Packing is one parent rate. Legacy Mixes start from the weight-weighted child average ([TCB packing](tcb-packing-final-box-totals.md)). |
| `product_mix_contract`, `packaging_fields_web_contract`, `packaging_scope_sql_contract` | Product Category must be an active Category Master row. Tests create the category inside their rolled-back transaction. |
| `opportunity_mix_sql_contract`, `packaging_scope_sql_contract` | Excel saves send the current `template_version` (taken from `TEMPLATE_VERSIONS`). |
| `packaging_fields_web_contract`, `packaging_scope_sql_contract` | Old migrations (23–71) are no longer replayed in setUp, so the tests use today's procedures. Response layers use real top-level Packaging Types. The Opportunity grid shows a packaging response only once Approved. |
| `packaging_scope_sql_contract` | A Mix child request copies the parent's logistics (migration 86). |
| `business_deletion_contract` | Its Packaging Type fixture respects `CK_PackagingType_AutoCopyDim`. |
| `shipment.spec.ts` | Packing is entered in TCB, not the Opportunity editor. Payment term follows Margin in reading order. |
| `products.spec.ts` | Weight units come from the UoM master; Category is required. |
| `opportunity-edit.spec.ts` | The Packaging Request tab has a fixed column set; layout prefixes are checked on TCB Review. |
| `packaging-polish.spec.ts`, `compact-interactions.spec.ts`, `packaging-fields.spec.ts` | Locked types are read-only text. Packing Way labels scale between 10 and 12px. Layers are bordered sections. Review actions wrap in their cell. Saved layouts gain new columns. Managers don't approve their own PIC work. The request editor shows review actions. |
| `pkg-pricing.spec.ts` | The footer stays pinned while content scrolls, measured after its status line appears. |

## Still failing (known)

A full run (`npx.cmd playwright test`, about 41 minutes with one worker) gives **788 passed, 112 failed, 35 skipped**. Every failure in the specs below also fails on the previous commit (86b816a), checked with a `git stash` baseline. These tests have been out of date for a while; the import fix above is what first let them run in a single pass.

- `opportunity-losses` (17), `tcb` (17), `packaging-summary` (18), `packing-way` (11), `pallet-master` (8), `tcb-versions` (6), `opportunity-pcr-link` (6), `item-layout-refresh` (4), `process-flow` (4), `requirement-sections` (4), `response-defaults` (3), `grade-process-loss` (2), `request-design` (2)
- One each: `actions-first`, `container-load`, `datetime`, `masters`, `packaging-copy-reference`, `product-shelf-life`, `profile`, `request-editor`, `shared-master-view`, `workbench`

Suggested next step: rewrite these specs file by file against the current screens, as was done above.

## Deployment

Deploy `webapp/dist/` built from the same commit and hard-refresh browsers. No API change or SQL migration is needed for this page.

## Verification

```powershell
$env:PYTHONPATH="core;tests/python"
python tests/python/npd_recipe_contract.py; python tests/python/recipe_scope_contract.py
python tests/python/mix_child_others_contract.py; python tests/python/product_mix_contract.py
python tests/python/opportunity_mix_sql_contract.py; python tests/python/packaging_fields_web_contract.py
python tests/python/packaging_scope_sql_contract.py; python -m unittest business_deletion_contract
cd webapp; npx.cmd playwright test tests/shipment.spec.ts tests/products.spec.ts tests/opportunity-edit.spec.ts tests/packaging-polish.spec.ts tests/compact-interactions.spec.ts tests/packaging-fields.spec.ts tests/pkg-pricing.spec.ts
```
