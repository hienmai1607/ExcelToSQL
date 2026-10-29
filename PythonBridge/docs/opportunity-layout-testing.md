# Opportunity layout testing

Status: withdrawn at the user's request. The previous Opportunity layout is restored for all users, including browsers with a saved Testing preference. The layout switch and Testing badge are hidden. The experimental source is retained as inactive reference; review cases and saved data are unchanged. No SQL rollback is required.

This is a reversible presentation experiment for New/Edit Opportunity. It keeps the existing full-size popup, wording, master controls, request locks and save workflow. It introduces no database fields or API endpoints.

## Testing view

- Product Info, Packaging, Palletization, Logistics & Co-Man, and Financials tabs replace the long item form.
- The summary shows the parent/standalone items and their Mix children. Edit details opens one item using the full available width.
- Child editing keeps its parent/item context visible. The item selector navigates without opening more nested editor popups.
- Packaging shows one layer at a time, using the existing quantities, type choices, requirements and comments. All requested layers remain part of the same draft.
- Header Info can collapse while editing an item. The footer remains visible; the content uses one scroll surface rather than stacked scrolling panels.
- Apply to item list stages edits in the shared Opportunity draft. Review & save remains the final document confirmation. Going Back or changing tabs does not discard edits.
- Validation still examines the entire draft. An item error reveals the corresponding item/tab; header errors reopen Header Info.

## Immediate rollback

Click **Current layout** at the top of the form. It reuses the same state, so entered values remain available. Click **Testing layout** to return. The choice is stored only in this browser, per user, under `bridge.opportunityLayout.<user ID>`.

For a release-wide rollback, set `opportunityTestingLayoutEnabled=false` in `webapp/src/opportunity-create.tsx`, then rebuild and deploy `webapp/dist`. This hard switch overrides stored Testing preferences. `defaultOpportunityTestingLayout` controls the initial choice for users with no saved preference.

No SQL rollback is needed for this layout experiment. Earlier migration 153 remains required for the existing pallet comments feature.

## Verification

The opt-in `webapp/tests/opportunity-testing-layout-live.spec.ts` runs against the retained desktop review cases OPP-2026-10328 (standalone, four layers) and OPP-2026-10321 (Mix).

Run with `DESKTOP_LAYOUT_CHECK=1`. API save requests are intercepted: no review data is saved. Checks compare Testing and Current payloads for the same edits, popup dimensions, tab/layer navigation, Mix parent derived weight, invalid hidden fields, preserved edits after rollback, and a single scroll surface at 1366x768. Desktop screenshots are retained under `artifacts/layout-testing`.
