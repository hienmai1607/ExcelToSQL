# TCB packing, final-box totals and Processing with Loss

This update requires no new SQL migration after 153. Deploy the updated `core` and complete `webapp/dist`, restart the API, then hard-refresh the browser. The desktop API has been restarted with four workers for review.

Packing cost is entered in TCB immediately before Palletization, on standalone items and Mix parents. The parent's USD/lbs rate applies to each child's own net weight. Existing Mix cases initially use the exact weight-weighted average of the captured child rates, preserving the total packing cost. Editing and saving the parent rate stores the override in its TCB approach. An explicit zero overrides the legacy rates. Legacy Shipment values remain available for compatibility but their input is hidden in Opportunity.

Palletization displays two decimals; its underlying calculation retains precision.

Analysis and both comparison views show USD/customer-currency values for FOB, CFR and DDP. DDP's two currency rows are combined. Each selling total is followed by a per final box row. Standalone totals multiply the unrounded unit price by all contained units. Mix totals multiply each unrounded child unit price by its captured Mix quantity, sum the children, then multiply by the parent final-layer unit factors. Mix cells merge only within the same family/approach. Each currency total is independently rounded upward to two decimals, without converting an already-rounded USD total.

Recipe Info displays Processing with Loss after Processing. It is Processing divided by the surviving grade yield, and is used in Line product. For blends, the effective loss reconciles RM before/after loss, matching the displayed Loss Process percentage. New saved recipes capture the adjusted processing charge. Existing supported snapshots can be recalculated from captured prices without reading live masters or rewriting historical JSON. The oldest leaf-recipe/global-product-loss snapshots retain their original overall-yield calculation, which already covers Processing.

Total RM before/after loss now shows the RM contribution per pound of finished recipe: each grade price is multiplied by its Level 1 recipe RM Ratio and grade proportion. Line RM remains a material unit price. Line product continues to apply RM Ratio exactly once. Existing supported saved totals are normalized on read from captured recipes/prices without rewriting historical JSON.

Validation: 38 focused browser/model tests, 54 Python contracts and one desktop save/reopen rollback contract passed. The end-to-end four-item workflow passed 214 business/API checks in a rollback-only run. The production build passed. Tests used retained desktop review Opportunity OPP-2026-10336; temporary writes were rolled back or intercepted. Screenshots are under `artifacts/layout-testing/tcb-*.png`.

Packaging Summary now displays captured VND-sourced costs as VND / USD, with USD-only values for costs without VND pricing. Customer currency is no longer used for this summary. Shared roll-ups retain the presence of VND source pricing and convert the exact USD total using Opportunity VND/USD rates before display rounding.

Loading cost: Pallet load uses pallet cost; Floor load and Both use only FloorLoadUSDPerMT multiplied by each child applicable net weight in grams / 1,000,000. Pallet cost is excluded from these two modes in both browser and API/grid costing, and therefore from final-carton selling totals. Destination charges expressed per pallet remain separate commercial charges.
