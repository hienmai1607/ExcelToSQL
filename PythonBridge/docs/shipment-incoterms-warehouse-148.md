# Incoterms and warehouse costs (148)

The alphabetical Incoterm list contains CFA (existing), CFR, CIF, CIP, CPT, DAP, DDP, DPU, EXW, FAS, FCA and FOB, without duplicates. Incoterm selection no longer hides Co-Man or other cost fields. Existing Mix parent/child ownership and loading-mode controls remain applicable.

Fobbing (USD/cont) is the first Logistics field, immediately before Freight (USD/cont). Shipment cost labels use USD instead of `$` and cont instead of Container/container. Destination costs retain the actual customer currency.

The WH Cost calculator stores Unloading, Palletize, Inbound, Outbound, StorageCostPerMonth, StorageMonths, OrderFeeAdminCost and OthersCost inside `ShipmentCostInfo.WHCostBreakdown`. Its total is:

`Unloading + Palletize + Inbound + Outbound + StorageCostPerMonth × StorageMonths + OrderFeeAdminCost + OthersCost`

The total is rounded half up to two decimals and stored in the existing `WHCostCustomerPerPallet` field. TCB continues to convert this total using the Opportunity exchange rate and distribute it by pallet units. The API and SQL save boundary reject mismatched totals or invalid components. Storage months can have two decimal places. Zero is valid. Cancel preserves the previous calculation. Reopening restores all eight inputs.

The WH total is read-only in the form and is changed through the calculator. When customer currency is USD, the duplicate USD conversion output is hidden; other currencies retain their conversion preview. Existing direct totals and legacy USD values remain supported. An Excel total override clears the prior breakdown; applying the calculator clears the legacy USD warehouse amount. Existing saved business data is not rewritten.

## Deployment

For a VM already through 147, back up the database, stop the API, run `sql/148_shipment_incoterms_warehouse_cost.sql` in the application database, deploy matching API/frontend files and restart the API. For an older VM, first follow the existing 142–147 upgrade checklist. Migration 148 is rerunnable. It extends the shipment validator; no table or data migration is required. The published 142–147 bundle does not contain 148.

Migration 148 has been applied on desktop test. Restart the desktop API and hard-refresh the browser before testing the new API fields.

## Checks

`python tests/python/warehouse_cost_contract.py` covers arithmetic, rounding, validation, TCB conversion, Excel overrides, SQL validator parity, reruns and an audited shipment save/read roundtrip that rolls back and verifies restoration of the original row/version. `webapp/tests/shipment.spec.ts` covers all Incoterms, visible sections, Fobbing order, calculator Apply/Cancel/reopen, currency conversion, serialization and desktop/mobile layout.

The broader legacy `opportunity_excel_contract.py` still has four failing checks for child lock prompts, header delete expectations, missing template version and validation counts. The same four fail when loading the unchanged core modules from Git HEAD; this feature introduces no additional failures in that suite.
