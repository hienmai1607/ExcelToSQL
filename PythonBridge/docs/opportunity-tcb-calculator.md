# Opportunity TCB Calculator

Open the calculator icon beside an Opportunity item in the detail grid.
Save the Opportunity item first. The calculator has its own Save TCB action.

## Product

Only regular products and Mix children have Product costing. Mix parents do not
roll up or maintain Product cost at this stage, per the user's decision.

Grades come from the item's Opportunity grade snapshot, not the current Product
Master version. Each leaf displays its final proportion: multiply every ratio
along its path. Select one material/vendor/quantity-tier price per grade leaf.
An assigned material restricts the choices to that material; otherwise eligible
materials assigned to the leaf's Raw Grade are offered. The user chooses the
quantity tier explicitly; demand does not automatically choose a tier.

Only active grades/materials/vendors and active prices effective today are
offered. A missing USD exchange rate or pound conversion cannot produce a cost.
Prices use their captured Vendor currency per USD rate, not the customer rate.
Configured material/vendor-specific or global unit conversions are honored;
standard KG/G/OZ/LB/LBS mass factors are fallbacks. All arithmetic is Decimal on
the server; monetary outputs are displayed to two decimals without rounding the
stored calculations.

- RM Cost USD/lb = sum(final grade proportion × selected material USD/lb).
- RM Ratio + Seasoning/salt Ratio + Oil % must equal 100.
- Product USD/lb = RM Cost × RM Ratio/100 + Seasoning/salt USD/lb × its Ratio/100
  + Oil USD/lb × Oil %/100 + Processing USD/lb.
- A zero-ratio ingredient needs no price. Its missing price is not treated as a
  known zero RM Cost.
- Loss product % is now calculated from the Loss process table; it does not change the price formula above.

The popup calculates immediately as inputs change. Save revalidates and
recalculates on the server; submitted derived values are not accepted.

## Packaging

Regular products and Mix children show Primary/Secondary/Tertiary PM USD/EA.
Mix parents show Mix Primary/Secondary/Tertiary PM USD/EA instead.
These are the layer's own price per unit from the linked packaging response,
not cumulative cost or allocated packaging cost per smallest unit.
Only confirmed visible response layers have a price; unavailable values remain
blank, not zero. Existing sales/draft-response visibility rules are retained.

VND prices use the Opportunity VND-per-USD rate. Customer-currency prices use
the Opportunity customer-currency-per-USD rate. Other currencies use the
response's captured UnitUSDPrice when available. These live response-derived
prices are display-only, not editable or copied into TCB.

Each applicable layer has its own calculated Loss %; Pallet USD/EA is manual.
Packaging losses are separate outputs; no loss-adjusted landed cost engine is
introduced by this feature.

## Loss process

Maintain free-text Process Type names, default sequence, default Loss % and
Active/Block status in Shared masters > Loss Process Master (Admin only).
No calculation-category dropdown is maintained in this master.

Both Loss Process and Port of Entry use the shared master list and Vendor-style
record-section editor, Add record section and Review & save confirmation.
Multiple creates report per-record errors; successful records are not resubmitted.

In Products, use the Loss processes icon next to Grades to assign Product loss
processes, sequence and default Loss %. Only regular products and Mix children
have Product loss. These assignments are captured into each new Opportunity
item's ProductLossSnapshot; later Product edits do not reprice old items.

In Opportunity TCB, Product process identity and sequence are read-only, but
Loss % is editable. Primary/Secondary/Tertiary PM and Mix PM processes are
assigned in TCB, separately per applicable layer; each has editable sequence
and Loss %. Sequence numbers must be unique within each loss group, not across
different layers. Loss edits remain item-local and never update masters.

Sorting and Processing (for example Roasting) combine into Product loss:
100 × (1 − product(1 − step loss / 100)).
For two steps: 100 − (100 − loss1) × (100 − loss2) / 100.
For example 5% Sorting then 10% Roasting gives 14.50%, not 15%.

Packaging processes combine separately for each layer. For example two Primary
packaging steps of 2% and 3% give 4.94% Primary loss, without adding those losses
to Product or Secondary loss. Only the active confirmed response layers are
offered; requested layers are used before a response exists. Mix parents offer
only Mix packaging process types and still have no Product costing.

Final losses are display-only, calculated immediately in the popup and
recalculated by the server on save. Posted totals cannot override the processes.
Sequence is respected and no intermediate display rounding is used.
Losses are stored with the process rows in the existing TCBCostInfo JSON.

Older scalar losses remain readable. The popup preserves them as one generic
Processing or matching packaging row until the user supplies the actual steps;
it does not guess that a historical Product loss was specifically Sorting.
Assigned master IDs, versions and values are saved as snapshots. Later master
edits or blocking do not alter existing assignments; explicitly reselect an
active entry to adopt its current process name. Loss % overrides are allowed.
Legacy Product rows are retained with editable Loss %; legacy PM rows can be
edited or removed. New assignments are checked against the active
master at resolution and atomically at save.

## Persistence and permissions

Inputs, authoritative RM/Product results, grade snapshot, selected price IDs,
price versions, conversion factors and price snapshots are stored in
OpportunityItem.TCBCostInfo. Reopening shows saved material costs, even after
today's Pricing Master has changed. To save again, reselect a current price if
the saved price changed or expired. Price versions prevent silent repricing
between selection and saving.

Opportunity/Admin scope is required. Header and item must both be Draft to edit.
An active PCR does not lock commercial TCB inputs. Item rowversion and selected
raw price rowversions are checked. Saves write an Opportunity change-log entry.
Product/Raw Material Masters and PCR snapshots are never modified.

## Deployment

Apply sql/91_opportunity_tcb.sql after migration 90, then
sql/92_loss_process_master.sql, then sql/93_loss_process_names.sql in the intended database.
Migration 93 adds free-text names, Product assignments and Opportunity snapshots.
Apply migrations only after testing and backup in the intended environment. Migration 92 creates
the master and adds atomic assignment validation to the TCB save procedure.
It adds one nullable JSON column and the guarded save procedure; it is rerunnable
and does not clear history. Deploy the updated core files and webapp/dist,
then restart the API and refresh the browser. No Excel-template change is part
of this calculator feature.

## Verification

- tests/python/tcb_costs_contract.py: Decimal math, nested grades, ratios, price
  membership/version, SQL persistence/audit, immutable PCR, stage/access guards.
  SQL integration fixtures and migration changes roll back on the local test DB.
- webapp/tests/tcb.spec.ts: live costing, response USD prices, inputs/save,
  Mix-parent exclusion, invalid ratios, process losses, legacy loss preservation,
  unsaved-close and read-only behaviour.
- webapp/tests/loss-process-master.spec.ts: Admin maintenance, versioned blocking,
  and Opportunity read-only access.


## Opportunity-owned losses (migration 94)

Loss Process Master maintains only Process Type and Status. Sequence and Loss %
are entered per Opportunity item, using the Loss processes icon beside Grades
or the item-row icon. Product Master no longer assigns loss processes. Product
loss and packaging/Mix packaging loss groups remain separate; combined loss
is calculated from sequential yields. Item-only loss saves do not require material
price selection and preserve existing costing inputs. Saved historical item
assignments remain editable. New items do not inherit Product losses.

Deploy migration 94 after 93, updated core code and webapp/dist; restart the API.
Historical Product loss columns are retained for recovery, but no longer used.


## Loss tabs and formulas (migration 95)

Item Loss processes has Product Loss and Packaging Loss tabs. TCB displays totals
but does not edit losses. Product rows choose a master Loss type and enter a ratio
in percent; codes L1, L2, etc. follow top-to-bottom order and renumber on removal.
Product Loss Formula supports decimal constants, loss codes, parentheses and
+ - * /, with the same bounded Decimal arithmetic engine as dimensions.
Use Test calculation to check it. For 5% and 10%, the sequential formula is
100-(100-L1)*(100-L2)/100 = 14.5%. Blank preserves sequential-yield calculation.
Formula output must be between 0 and 100%; unknown codes/division by zero fail.
Packaging Loss has exactly one editable ratio per applicable packaging layer,
including Mix layers. Historical multiple steps collapse to their combined ratio
when opening the item editor; changes persist only on save. Mix Product loss
remains on children. Deploy 95 after 94 along with core and webapp/dist.


## Opportunity-level loss workspace

Use Edit all item losses in the Opportunity detail toolbar or the icon beside its
Opportunity number. All parent and child items load together, regardless of
which children are expanded in the item list. Product Loss uses expandable item
sections; Packaging Loss is a combined table with only applicable layers enabled.
Mix parents have packaging ratios only. Non-Draft items remain read-only.
Copy from item applies the current tab to selected editable items. Product copies
include type assignments, ratios and formula; Packaging copies match layer positions.
Review validates each changed item's formula before any write. Confirm save uses
row-version-protected item saves. Completed saves are tracked so a partial failure
keeps remaining edits and retry does not resubmit completed items.
No new SQL migration is needed beyond 95.

## Opportunity-wide Nuts Grades and Raw Pricing

The same Opportunity-level popup includes Nuts Grades and Raw Pricing tabs.
Each tab includes every parent/child item, not only expanded grid rows. Mix parents
show their structure; grade snapshots and raw quote inputs belong to children.

Nuts Grades edits only the Opportunity snapshot using existing grade/material
masters and balanced sibling ratios. An active Packaging Request locks the grade
snapshot, but Draft-item raw pricing and loss inputs remain editable. Non-Draft
items are read-only. Changing grades clears that item's old price selections;
load pricing for the new grades before choosing replacement quotes.

Raw Pricing selects existing active material/vendor/quantity-tier master quotes,
converted to USD/lb. There is no Opportunity price override and no pricing master
write. Every selected quote is checked for its version and converted price.
Unpriced leaves may be saved, but RM and Product costs stay uncalculated until
all leaves have valid selections.

Review & save handles all changed items across all four tabs. A grade snapshot,
quote selections and loss inputs are saved atomically per item, with row-version
checks and existing cost/composition inputs preserved. Partial failures keep
remaining edits and do not resubmit completed items.
Deploy updated core code and webapp/dist and restart the API; this extension
requires no migration beyond 95.

## Opportunity-level TCB tab and response-only summaries

TCB Calculator is now a fifth tab in the Opportunity item popup. It shows every
item in expandable parent/child sections, with four fields per desktop row.
Product composition/processing and pallet costs are editable on Draft items;
grades and selected master quotes are maintained in the adjacent tabs. Losses
are displayed from the Product Loss and Packaging Loss tabs. Mix parents show
only their packaging layers and pallet input, not Product composition.

Review & save combines cost, grade, quote and loss changes and preserves
partial-save recovery. Closing after a save refreshes the grid while keeping
Opportunity details open. TCB is no longer an item-row icon. Packaging Summary
is an item-row icon only in the Packaging Responses view, not All Fields,
Product Info or Packaging Request.

Deploy updated core code and webapp/dist, restart the API and refresh the browser.
No new SQL migration is required beyond 95.

Pallet cost is owned by top-level items only (Mix parents and standalone products).
Child items have no pallet input. API reads and saves exclude historical child
pallet amounts, without changing their Product composition costs.

## Combined TCB grades and raw pricing (migration 96)

Raw Pricing is now integrated into the TCB Calculator tab; there is no separate
Raw Pricing tab. Each non-Mix Product section has an inline Edit grades panel
and a grade-leaf price table. Nuts Grades remains an alternate view of the same
Opportunity snapshot. Existing active-PCR grade locks still apply.

The Direct checkbox switches a leaf from master-quote selection to an
Opportunity-only USD/lb input. Enter a non-negative decimal (up to six decimals;
zero is allowed). A leaf can use either a master quote or a direct price, never
both. Unchecking clears the direct price so the user can choose a master quote.
Grade changes clear all price selections to avoid associating old prices with
new grade paths. Direct values save with the item, reopen checked, and do not
change Raw Material Pricing Master.

RM Cost = sum(final leaf proportion × master or direct USD/lb). Product cost
uses this RM cost and the existing composition/processing formula. Direct price
snapshots are explicitly marked Source=Direct; master snapshots keep version
checks and direct snapshots must match their input values.

Deploy 96 after 95 with updated core and webapp/dist, restart the API and refresh
the browser. Migration 96 has been applied to the local test database.

The Opportunity popup now has only Product Loss, Packaging Loss and TCB Calculator
tabs. Nuts Grades has been removed; use Edit grades within each TCB Product section.

## Parent-item TCB Review

TCB Review is launched from the calculator icon on top-level (non-child) item
rows in Product Info only. The Opportunity overview and detail toolbar no longer
have a review launcher. A Mix parent's review includes that parent and all its
descendants, regardless of grid expansion; a standalone item's review is separate.
Unrelated Opportunity items are not loaded or saved by that review.

The popup is one continuous screen without tabs, grouped into expandable item
sections. Each item includes Product costing and inline grades/raw pricing,
Product Loss type/code/ratio/formula, and Packaging prices with editable loss
ratios per applicable layer. Mix parents omit Product inputs; pallet cost remains
top-level only. Copy losses selects Product or Packaging through a dropdown.

Review & save, repeated saves, row-version protection, active-PCR grade locks,
read-only stages and partial-save retries are unchanged.
Deploy the rebuilt webapp/dist and refresh the browser; no SQL/API change is needed.

## TCB Review Analysis

Use Analysis beside the Opportunity number in TCB Review; Back to TCB inputs
returns to the same unsaved drafts. Analysis is read-only and does not save.
It includes the selected top-level item and its children, not unrelated items.

The first column contains the 12 cost components. Remaining columns show each
smallest product unit; a Mix parent column reconciles the children multiplied
by their quantities, per mix unit. Configured container types have independent
results. Both loading shows separate Pallet-load and Floor-load tables.

Calculations use exact rational arithmetic with 453.59237 grams per pound;
rounding to two decimals is display-only. Product USD/unit is Product USD/lb
divided by that mass factor, multiplied by net grams and
(1 - Product loss percentage / 100), as requested. Custom Product loss formulas
are tested by the existing server endpoint using current drafts, without saving.
No expression is executed as JavaScript.

Self packaging sums each response layer's own USD price divided by the number
of smallest units contained in that layer. Parent packaging uses the same
normalization per mix unit, then divides by total captured child quantity.
Each packaging layer cost is adjusted by its own loss ratio: price / (1 - loss% / 100), then normalized to the smallest product unit. This applies independently to both child and Mix parent layers before parent allocation. A 100% loss has no surviving yield and shows Incomplete instead of a cost.

Shared parent packaging, pallet, design, fixed and fobbing costs are equal per
smallest child unit, not allocated by weight. A Mix pallet's smallest-unit
capacity is parent UnitsPerPallet multiplied by total child quantity. Container
capacity is the response's final-layer carton count multiplied by the parent
final-layer unit count and total child quantity. Floor load has zero pallet cost.
Fobbing uses the capacity of the corresponding type and loading method.

Packing USD/unit is parent Packing USD/lb divided by 453.59237 and multiplied
by each child's net grams. Estimated awarded units are parent AnnualUnit
multiplied by EstPctAwarded / 100, and for Mix multiplied by total child quantity.
Design and fixed costs divide by that amount. Interest is the subtotal of rows
1-8 multiplied by InterestPct / 100 and InterestMonths / 12. Margin includes
Interest: subtotal of rows 1-9 multiplied by MarginPct / 100. FOB sums rows 1-10.
Customer FOB uses the Opportunity currency-per-USD rate, or VND-per-USD for VND.

Blank optional shipment costs are treated as zero. Missing Product/PM prices,
net weight, positive allocation denominators, parent pallet price, Mix
composition or FX cause Incomplete with an explanation. Zero optional costs
need no allocation denominator. Incomplete inputs propagate into FOB.
Partial captured Mix compositions are never reallocated across only visible
children. Explicit zero pallet cost is allowed.

Deploy rebuilt webapp/dist and refresh the browser. This Analysis addition
requires no SQL migration or API restart.

## Current Analysis display: child products only

The Analysis action is now a chart icon beside the Opportunity number, with
an accessible Analysis label and tooltip. The return action is a back icon.
Standalone items do not offer Analysis. Mix reviews display only child product
columns, without a Mix-parent roll-up column.

Analysis shows one table using the response's selected container, not separate
Pallet-load/Floor-load or container-profile tables. Pallet-only and floor-only
requests retain their corresponding cost calculations. Both (or an unset
loading method) is deliberately deferred: pallet and fobbing costs, and hence
Interest, Margin and FOB, remain Incomplete with an explanation. No loading
method is silently selected for Both. Non-loading cost rows remain available.
Shared parent costs still use equal allocation per smallest child unit.

Deploy rebuilt webapp/dist and refresh the browser. No API restart or migration
is needed for this display change.


## Destination logistics, Co-Man and DDP Analysis

A separator below FOB introduces 16 additional rows. Container-priced charges
use total smallest product units per selected container; pallet-priced charges,
including destination WH cost, use total smallest units per pallet. Mix parent
charges retain equal allocation per smallest child unit.

Duty is (FOB + Freight) × Duty ratio. Damage applies to FOB plus Freight, Duty,
Clearance, Haulage and destination WH cost. The base for the four allowance/fee
rows is FOB plus all nine destination cost rows (including Damage). Each fee is
base / (1 - sum of the four fee ratios) × its own ratio. Combined ratios must
be below 100%; otherwise the fees and DDP show Incomplete.

CFR = FOB + Freight and is a display subtotal only. DDP = FOB + rows 1–13,
without adding CFR again. DDP customer currency uses the Opportunity exchange
rate. Both loading remains deferred; incomplete capacity-dependent costs are
not silently filled in. Blank optional charges and ratios are treated as zero.

## Opportunity TCB Review columns and Excel

The Opportunity item grid has a TCB Review tab with 28 read-only Analysis
columns. The Item layout offers four TCB Review subgroups: FOB Costing,
Destination Logistics, Co-Man & Fees, and Selling Totals. Existing layouts
migrate to field version 10 once; later hidden columns remain hidden.

These columns use saved TCBCostInfo and the permission-filtered packaging
responses, not unsaved popup edits or automatic repricing from changed masters.
Saving TCB Review and closing it refreshes the grid. Mix parents have blank
result columns; standalone and child products have per-unit results. Missing
inputs and deferred Both loading produce blank values rather than guessed costs.

Opportunity Excel follows the selected layout and exports these values under
TCB Review group/subgroup headers, with Auto calculate category cells. They
cannot be imported as edits. No database migration is required. Restart the API
to load the new grid/export calculation module, then refresh the browser.

## Analysis for standalone products

Analysis is also available for standalone products. Their own shipment, pallet,
awarded-unit and container quantities are used directly; Parent Packaging is zero.
Mix parents remain excluded from result columns, while their child products retain
equal shared-parent cost allocation. Both loading remains deferred.

### Validation and scrolling

TCB Review shows validation beside the affected cost, price, or loss ratio instead of floating alerts. An item-linked summary opens collapsed sections and focuses the affected field. Read-only items are excluded from save validation; partial saves retain remaining edits. The grid keeps both TCB header rows together while scrolling.
