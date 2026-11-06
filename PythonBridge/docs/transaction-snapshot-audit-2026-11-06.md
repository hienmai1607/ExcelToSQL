# Transaction snapshot audit — 6 November 2026

The system has substantial snapshot coverage, but a transaction is not necessarily a complete frozen copy of everything shown on its screen. In particular, an active TCB combines saved costing data with current transaction context and some current master configuration.

This audit checked the current desktop source, deployed SQL procedure/view definitions, and records in the desktop `test` database. It did not inspect the VM. Database checks were read-only; no masters, transactions, approvals or settings were changed. The Process Type mapping experiment below changed an in-memory copy only.

## Meaning of snapshot

- **Captured:** later edits to the source master do not rewrite the captured values.
- **Partial:** some values are captured, while other displayed fields or calculation inputs remain live.
- **Live:** reads resolve the current referenced record or current configuration.
- **Transaction-owned:** entered and stored on the transaction. A master edit does not replace it, but an authorized transaction edit can. This is different from an immutable historical revision.

An explicit refresh, reselection, recalculation, new approval or version activation can intentionally replace the transaction's current selection. Keeping the older snapshot record does not mean the current transaction will always continue using it.

## Transaction and field coverage

| Area | Captured fields / data | Capture point | Remaining live behavior |
| --- | --- | --- | --- |
| Opportunity product selection | Product net weight; grade tree, ratios, process flags and material assignments; recipe-confirmation requirements in the grade snapshot | Creation / product selection / explicit snapshot refresh | Product code/name, shelf life and some product metadata still resolve from Product Master. Customer name/currency and packaging-type/port labels also use masters. |
| Opportunity Mix composition | Mix version reference, child products and quantities; generated child rows and captured child weights | Mix selection / composition capture | Product names/codes remain live. Parent net weight is derived from children. Legacy missing grade snapshots can fall back to the active master grade tree. |
| Opportunity commercial fields | Description, dates, annual units, estimated award, shelf price, numerical exchange rates; entered shipment/logistics/WH/co-man/fee values | Opportunity save | These are editable transaction values, not a permanent quotation snapshot. Current analysis uses the current Opportunity values. |
| Packaging Request header | Opportunity number/description, customer name, bid dates, source currency/code/rate, requested date/user ID, due date and request note | Request creation | User display names resolve from Users. Request workflow state is current. |
| Packaging Request items | Product code/name, description, annual units, weight, category/grade/mix metadata, estimated award, shelf price/life, grade/Mix snapshots; requested layers/types/names, quantities, properties, comments, pallet/container requirements | Request creation | PIC and review state remain transaction state. A linked ID alone is not a snapshot of the referenced user's name. |
| Packaging response configuration | Confirmed layer counts/types, unit quantities, selected dimensions/prices, response density, pallet configuration, comments and proposed containers | Response save | Some gross weights and efficiency values are derived from the saved inputs rather than stored as final immutable numbers. Current published selection may change after another response is approved. |
| Packaging layer pricing — all four layers | Type identity/version/name; dimension definitions/measurements; formulas/conversions; material, vendor, price tier/effective dates/currency; quantities, MOQ, tare, unit price/USD price and context | Pricing calculation applied and saved with the response | New calculations use current master data and create/supersede the current pricing snapshot. Historical pricing records remain. |
| Pallet pricing | Base pallet material, dimensions, max payload, tare, accessories, quantities, selected quotes, original-currency total and USD total when available | Apply pallet pricing | If the snapshot has no USD total, its original-currency total is converted using the owning Opportunity's current FX rate. |
| Container load plan | Container/carton/pallet dimensions, payload and door/clearance limits, stacking/rotation settings; counts, layout result, weights, pallet pricing and weight snapshot | Save / apply load plan | New proposals use current masters. Changing physical response inputs can invalidate the current plan selection while retaining historical plans. |
| Recipe Request header/items | Opportunity number/customer name; requested date/user, due date/note; product code/name, weight, annual units, estimated award, grade snapshot, launching date and special comments | Recipe Request creation | PIC assignment is current. Users' displayed names are live. Request does not itself capture the sheet's FX; each sheet does that separately. |
| Recipe Sheet | Input lines, ratios, losses, direct prices/vendors, notes; calculated ingredient descriptions/nature/origin, quotes, currency conversions, buffered quantities and totals; sheet VND/USD rate | Save, submission and approval | Draft calculation uses current applicable masters/prices. Some screen labels still use current lookup data; see gaps below. Approved sheets cannot be edited in place. |
| Approved Recipe → Opportunity/TCB | Approved sheet identity/revision, applicable grade paths, captured grades, seasoning ratio/price/loss, cost basis and approval information | Manager approval | A new Draft/Pending/Returned sheet does not replace the approved link. Another approved revision intentionally updates the current linked result. Manual TCB overrides are separately retained. |
| Saved TCB costing | Raw-price snapshots including material/vendor/tier/currency/conversion/version; grade tree; process identities, assigned ratios/formulas/results; recipe/component inputs and calculated RM/product costs | TCB save | Active TCB still uses current Process Type–Component mappings, current Opportunity commercial context and current approved packaging/pallet/recipe selections. |
| Inactive TCB versions | Saved costing, grades and captured Opportunity/TCB context, including component configuration and commercial/packaging context | Version creation and when the outgoing active version is deactivated | Explicitly saving an editable version or activating it can recalculate/revalidate. Legacy versions without ContextJSON fall back to current context. |
| Stage/history/audit records | Stage changes, actor IDs, times, reasons; before/after JSON where recorded | Each recorded action | Stage history is not a complete frozen quotation. Moving to Customer proposal does not itself create a full commercial snapshot. |

## Confirmed partial/live areas

### 1. Active TCB Process Type–Component mappings are not frozen

`catalog()` reads Recipe Components and Process Type mappings from the current masters. The TCB draft synchronizes component inputs against that catalog, and costing resolves it again. Saved component values therefore do not fully protect active calculations from a later mapping edit.

Read-only experiment on desktop item `3821199`:

| Grade path | Saved/current mapping | After removing the applicable mappings in an in-memory copy |
| --- | --- | --- |
| `0/1` | RM 91%; Salt 1%, Oil 2%, Seasoning 6% | RM 100%; no components |
| `0/2` | RM 94%; Seasoning 6% | RM 100%; no components |

No database values were changed. This confirms a calculation-input dependency on live mappings, not merely a changed display name. Reopening/recalculating active TCB can synchronize those inputs; the experiment did not save the changed result.

Evidence: [recipe_components.py](../core/recipe_components.py), [tcb-draft.ts](../webapp/src/tcb-draft.ts), [tcb_api.py](../core/tcb_api.py). Experiment output: `artifacts/snapshot-audit-2026-11-06/component-mapping-probe.json` (local audit evidence).

### 2. Opportunity metadata is only partly captured

The Opportunity view reads CustomerName from Customer, ProductCode/ProductName and ShelfLifeDays from Product, type labels from PackagingType and PortOfEntryName from PortOfEntry. The captured grade tree and product weight are separate and do not make these labels historical.

Customer currency is particularly relevant: the list reads the customer's current CurrencyID, and only exposes the stored customer FX rate if its captured RateCustomerCurrencyID still matches. Changing Customer Master currency can therefore change the displayed currency context or leave the rate unavailable. The numerical rate is stored, but the whole header context is not frozen.

Packaging Request and Recipe Request copy several of these fields at creation; those request copies have stronger protection than the corresponding Opportunity display.

Evidence: [opportunity_views.py](../core/opportunity_views.py), `artifacts/snapshot-audit-2026-11-06/v_OpportunityItemPackaging.sql` (local audit evidence).

### 3. Approved Recipe Sheet calculations are captured, but some displayed labels are live

The saved calculation includes ingredient descriptions, nature and origin. However, the Ingredient selector/code on the sheet is populated from current ingredient lookups even when disabled. A master rename can change the displayed ingredient name without changing the saved calculation. A missing/blocked lookup can also affect how the selected ingredient is presented. Direct-entry vendor labels come from current vendor lookups.

Sheet headers and the main sheet list resolve PIC through the request item's current assignment. Consequently, reassigning a request item can change the PIC displayed on an older approved sheet. The request's version table separately tries to obtain PIC from the creation audit, so the two views do not have identical historical behavior. Approver IDs are stored separately; displayed user names remain live.

Evidence: [npd-ingredient-table.tsx](../webapp/src/npd-ingredient-table.tsx), [npd_api.py](../core/npd_api.py).

### 4. Some packaging conversions and efficiency metrics have live fallbacks

- Pallet original-currency prices are captured. If UnitUSDPrice is absent, USD valuation uses current Opportunity FX. This does not reread the current pallet price master.
- Pallet utilization can use the current pallet master area when no saved load plan supplies captured dimensions. A saved plan overrides this with its captured pallet dimensions.
- Generating response dimensions for a new load preview uses captured measurements, but non-mm units are converted with the current unit-conversion function. An already saved load plan retains its own captured inputs/results.
- Packaging Summary is a derived view of saved packaging plus current Opportunity commercial costs/rates; it is not a separate snapshot document.

Evidence: [pallet_currency.py](../core/pallet_currency.py), [packaging_efficiency.py](../core/packaging_efficiency.py), [load_planning_api.py](../core/load_planning_api.py).

### 5. Active TCB and Customer proposal are not fully frozen commercial quotations

Saved TCB price/cost snapshots exist, and historical raw quotes are kept available. However, active analysis also consumes current Opportunity quantities, commercial costs and FX, plus the currently approved packaging/recipe selections. The TCB read path refreshes its pallet input from the published packaging selection.

Inactive TCB versions have captured ContextJSON. Active versions deliberately do not. Activating a version captures the outgoing context and revalidates/recalculates the new active version against current sources.

The deployed item stage-transition procedure records stage/audit information only. No separate full quotation snapshot was found at the Customer proposal transition. Stage locking and audit history should not be interpreted as a full capture of external master/context values.

Evidence: [tcb_versions_api.py](../core/tcb_versions_api.py), [tcb_api.py](../core/tcb_api.py), `artifacts/snapshot-audit-2026-11-06/usp_Opportunity_ItemStage_Transition_AuditImplementation.sql` (local audit evidence).

## Publication and refresh rules verified

- Opportunity packaging reads select **Approved** response items. Unapproved response work does not replace the approved Opportunity packaging result.
- Recipe publication occurs in manager approval. The request item's ActiveSheetID is updated there; new versions alone do not replace it.
- Explicit Copy reference uses current applicable pricing for the copied materials. It is a new configuration/pricing operation, not a promise to reuse a historical quote unchanged.
- Recalculation/submission/approval validate current quote/master state. Ingredient or price changes between submission and approval can block approval until the reviewer checks an updated calculation.
- A request's captured specifications and the linked Opportunity's current data are different records. Recipe approval rejects mismatched grade/weight/award context instead of silently using a stale request.

Evidence: [packaging_reference_api.py](../core/packaging_reference_api.py), [npd_api.py](../core/npd_api.py), `artifacts/snapshot-audit-2026-11-06/v_OpportunityItemPackaging.sql` (local audit evidence).

## Desktop data coverage

| Check | Observed result |
| --- | --- |
| Opportunity items | 29; all have captured product weight and grade snapshot; 23 have TCB JSON |
| Packaging Request headers | 13; all marked Request-origin with capture timestamp |
| Packaging Request items | 30; all have grades; 24 Approved and 6 Assigned |
| Approved packaging items with selected pallet but no pallet-pricing snapshot | 0 |
| Assigned packaging items with selected pallet but no pallet-pricing snapshot | 2; unfinished response work |
| Packaging pricing records | 56; all have valid snapshot and context JSON |
| Pallet pricing snapshots / saved container plans | 18 / 83 |
| Recipe Requests / items | 2 / 7; all 7 items have grade snapshots |
| Recipe Sheets | 10; all have CalculationJSON and captured VND/USD rate; 6 Approved, 2 Draft, 1 Pending, 1 Returned |
| Inactive TCB versions | 1; captured ContextJSON present |
| Active TCB versions | 29; no ContextJSON, by current implementation |

Presence of JSON demonstrates capture coverage, not that every business field inside every record is complete. No broad destructive master-edit test was performed. The mapping experiment exercised real calculation-input resolution with substituted in-memory data.

Evidence: `artifacts/snapshot-audit-2026-11-06/inventory.json` (local audit evidence). Deployed SQL definitions are retained in the same artifact directory.

## Masters and legacy records

Master tables are generally live catalogs. Effective dates, RowVersion checks and audit logs are useful, but do not themselves freeze a transaction's reference. Product Grade/Mix versions provide versioned structures; Opportunity and request snapshots provide an additional capture boundary.

Legacy fallbacks remain in code for missing snapshots: active Product Grades for missing Mix child grades, current FX for missing sheet rates or pallet USD totals, and current TCB context for versions without ContextJSON. Current desktop coverage above rules out several of those missing-data cases here, but the VM may have a different record population.

The most consequential candidates for further snapshot protection are active TCB component mappings, Opportunity customer-currency/product context, historical Recipe Sheet labels/PIC, and a full commercial snapshot at customer-proposal publication.
