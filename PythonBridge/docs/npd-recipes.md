# NPD recipes

The NPD workspace contains Ingredients Master, Ingredient Pricing, Recipe Components, Recipe Requests and Recipe Sheets. Apply SQL migrations 154 through 157 before deploying the matching API and web build. The migrations add schema, audit records, NPD Member / NPD Manager role templates, Salt/Oil/Seasoning components and a Seasoning process. Existing users are not assigned new roles automatically. Sales creates Recipe Requests using its Opportunity edit authority.

## Optional confirmation and captured requirements

Requires Recipe confirmation is maintained on a Product Grade version or on an Opportunity grade snapshot. A newly selected Product inherits its active Grade version setting. The Opportunity snapshot is independent of subsequent master changes. Products without this setting can use manual TCB components without a Recipe Request.

Enabled standalone products and individual Mix children show Recipe requirements: Launching date and Special comments. Mix parents do not receive ingredient recipes. Recipe Requests are created from Opportunity only. The Recipe Requests workspace lists existing requests; its Items count opens an inline item list with Product Info, Recipe Request and Recipe Sheets tabs, PIC display and paging. NPD managers and administrators can assign a PIC directly from the Review cell, using the same member validation and row-version checks as the request editor. The Opportunity items Recipe Request tab selects eligible items from the same Opportunity. Response due and Request notes are entered inline below the table; creation uses these selected items without another picker popup. Uncertain replies are retried with the same creation key and payload. The request captures these requirements, Product Grades, net weight, annual units and estimated award percentage; client-supplied replacement requirements are ignored.

One linked Recipe Request is allowed per Opportunity item. Its grades, Product identity, confirmation flag and requirements are locked in both the editor and database. A completed approval retains the link so NPD can create a revision. A manager may close the link with a reason after returning pending submissions; closing releases those edits and allows a new request. Approved sheets remain immutable. A former approval continues to supply seasoning until replaced, unless confirmation is disabled or the grade composition changes. Stale approvals cannot satisfy required confirmation.

Requests and sheets use creation keys for retry recovery. Row versions reject stale writes. The manager assigns an active NPD PIC. The assigned PIC edits sheets; managers review submissions. Administrators may perform either step for support/testing.

## Ingredients, quantities and prices

Ingredients Master and Ingredient Pricing use the shared master layout, search/status filters, sorting, export, column preferences and paging. Ingredient codes are assigned on save. Base and price UoMs must be maintained mass units because approved prices feed USD/lbs. Base UoM is fixed once ingredient pricing exists. Master and shortcut editors use the same validation. Approval snapshots retain the master and price values used.

Estimated awarded MT = annual units * estimated award percentage / 100 * net weight in grams / 1,000,000.

Mix children use their calculated child annual units and their parent's estimated award percentage. The request captures that effective percentage; approval checks the current parent value again before publishing.

Required ingredient quantity = Total Qty (KG) * 1,000 / base-unit grams.

Quantity-from is inclusive and quantity-to exclusive in the ingredient Base UoM. Effective dates are inclusive, evaluated on the current UTC date. Active ingredient/vendor/price/unit records must match. Same-vendor overlapping quantity/date ranges are blocked. Among applicable vendors the least expensive converted quote is proposed; NPD can choose another applicable quote. An explicitly selected but no-longer-applicable quote is rejected.

USD/lbs = unit price / currency units per USD * 453.59237 / price-unit grams. USD uses 1; VND uses the sheet exchange rate (VND / USD), initially copied from Opportunity. Customer currency uses the Opportunity rate. Other currencies need an explicit price exchange rate. Pricing tiers use buffered Total Qty, converted from MT to the ingredient base UoM. Sheet FX is saved with the revision; pending sheets are read-only for the PIC and editable by the reviewing manager; approved sheets are read-only.

## Recipe Components and processes

Recipe Components are configurable master data; Salt, Oil and Seasoning have stable system identities. Process Types maintain one or more involved components, shown in their Recipe Components list column. For example Oil Roasting can use Oil, while Oil Salted Roasting can use Oil and Salt. TCB Recipe Info shows price (USD/lbs) and ratio (%) columns only for components mapped to selected Process Loss types. Each grade uses its own and shared ancestor/descendant processes. An approved recipe or a saved nonzero value does not force an unmapped component to appear. Removing a process removes its otherwise unused components from the current calculation and rebalances RM Ratio; unrelated grades do not inherit them.

Selecting a process mapped to Seasoning supplies its Process Loss default, seasoning price and ratio from the approved linked Recipe Sheet. Draft, pending and returned revisions do not replace that approved source. Seasoning values are retained with the approved source for later selection, even when no Seasoning process is currently selected. Its finished-product cost contribution is added once, without multiplying the seasoning ratio a second time. Existing saved history is not rewritten by a master configuration change.

RM Ratio automatically becomes 100 minus all component ratios. Product cost is loss-adjusted RM cost times RM Ratio, plus each manual component price times its ratio (approved contribution-based Seasoning is added directly), plus Processing with Loss. Components are counted once. Positive ratios require prices and the total must be 100%.

## Recipe and approval

Each captured Level 1 grade supplies one fixed identity row. NPD may edit its ratio but cannot remove or replace it. Optional manual nut-grade prices are used only by the Sheet FG summaries; blank prices count as zero. TCB raw prices are unchanged. Fixed nut-grade loss remains zero. Added ingredient rows are seasoning. A Price Ready or Final recipe must total 100%, retain a positive raw share and have applicable quotes for every positive seasoning line.

Buffer Ratio (%) = Ratio (%) / (1 - Ingredient Loss (%) / 100). Total Qty (KG) = Buffer Ratio / 100 * estimated awarded MT * 1,000. Captured calculations retain TotalQtyMT internally for compatibility; the displayed column converts it to kilograms. Price columns normalize the selected quote to VND/KG and USD/KG; the sheet rate supplies the conversion.

Seasoning ratio = sum of seasoning row ratios. Seasoning USD/lbs = sum(ingredient USD/lbs * Ratio / 100), a weighted contribution per finished-product lb. TCB adds this contribution directly once, without multiplying by Seasoning Ratio again or increasing ingredient prices by loss. Zero seasoning gives zero seasoning cost. Fixed raw rows are excluded from seasoning price and ratio totals.

Loss by weight (%) is calculated in the footer across the entire recipe: (sum all Buffer Ratio / sum all Ratio - 1) * 100. The historical SeasoningLossPct storage key retains this value for compatibility. Drafts can retain an uplift at or above 100%, but submission and approval are blocked (including values rounding to 100% at the Process Loss precision). On approval it supplies the default Process Loss for a Seasoning process (or a Process Type mapped to the Seasoning component). It does not increase Seasoning USD/lbs a second time. Existing independently edited process percentages remain user-owned; adding a Seasoning process uses the approved default.

Recipe status (Draft / Price Ready / Final) is separate from approval (Draft / Pending / Approved / Returned). Either Price Ready or Final can be submitted. Approval recomputes quantities/prices and rejects changed quotes, masters or exchange rates since submission. Changed Opportunity grades, weight or estimated quantities require a current request. Draft saves, submission and return never publish to TCB.

Approval atomically snapshots the recipe, updates the linked Opportunity's current TCB and active TCB version, and completes the request item. The same Seasoning ratio/cost applies to every Level 1 TCB recipe, preserving other components and Processing. RM is rebalanced to 100 minus all components; a sum over 100 blocks approval. Captured raw prices are recalculated; missing raw costs remain incomplete. Required confirmation remains incomplete until a current approved sheet exists.

NPD raw-grade proportions do not overwrite Product Grades. Differences in normalized raw proportions are recorded and displayed for review. NPD Seasoning fields are read-only while confirmation is enabled; server-side saving enforces approved values. Historical TCB versions retain their captured recipe source.

## Verification

Run `python tests/python/npd_recipe_contract.py`, `python tests/python/npd_desktop_contract.py` and `python tests/python/recipe_components_contract.py`. Desktop contracts roll all business writes back. Browser contracts cover role-specific request/sheet actions, master shortcuts, mapped components, automatic RM ratios, confirmation requirements and linked locks. Run `npm.cmd run build` after the final UI edit. The opt-in `NPD_DESKTOP_LIVE=1` browser check verifies connected pages without writing business data.

Migration 156 extends the Sheet loss column for calculated buffer uplift and adds the captured exchange rate. It retains existing business values and approved calculations. Older approvals without SeasoningCostBasis use their original mixture-price semantics. Existing pending sheets need a refreshed calculation before approval: the manager may refresh/edit and approve it, or return it for PIC revision and resubmission. New approvals capture SeasoningCostBasis=FinishedProduct in TCB, including component and historical comparison snapshots.

Ingredient rows also accept direct Price (VND/KG) or Price (USD/KG). An applicable quote defaults to Auto, with both price columns locked. If no applicable quote is found for an unselected source, the default is Direct. In Direct mode, editing either price column converts the other using sheet FX; the entered currency and amount are retained to prevent conversion drift. A direct quote requires an active Ingredient, not a pricing master. Selecting an applicable master or Auto clears the override. Direct prices are stored and audited in LinesJSON and CalculationJSON, subject to the same sheet permissions, approval lock and publication rules. Direct prices are stored in JSON; migration 157 is required for the separate Ingredient grade/type/nature field. Manual nut prices do not replace TCB raw-grade pricing.


The recipe table follows the reference column order: No., Code, Ingredient, Grade/ type/ nature, Origin, Ratio, # (price source), Vendor, VND/KG, USD/KG, Ingredient Loss, Buffer Ratio, Note, Total Qty. Ingredient selection stays on one line; price source and its master shortcut are in #, with Vendor beside it; Ingredient rows show VND/KG and USD/KG only; the seasoning summary retains USD/lbs for TCB. Ratios and loss percentages display two decimals, with full precision retained for calculation and saving. Percentage input tooltips retain the full stored precision; display rounding never changes saved values. Total ratio is directly under Ratio in the table footer; Total Buffer Ratio is under Buffer Ratio. Both totals include every recipe row. Total Qty is displayed in KG. Fixed nut rows allow a manual ingredient description; seasoning descriptions, grade/type/nature and origin are captured from Ingredient Master. Nut origin is NA. Notes are editable on all rows and saved with the revision.

Footer summary order and formulas (ratios expressed as percentage values divided by 100):
1. Cost of FG ($/kg) = sum(all USD/kg * Ratio / 100).
2. Cost of FG with Buffer ($/kg) = sum(all USD/kg * Buffer Ratio / 100).
3. Loss by weight (%) = (sum all Buffer Ratio / sum all Ratio - 1) * 100.
4. Loss by value (%) = (buffered FG cost / FG cost - 1) * 100; undefined when FG cost is zero.
5. Seasoning price ($/kg) = sum(seasoning USD/kg * Ratio / 100).
6. Seasoning price ($/lbs) = seasoning price ($/kg) * 0.45359237.
7. Seasoning Ratio = sum(seasoning ratios).

Missing positive seasoning prices leave cost summaries blank until pricing is complete. Existing approved results stay captured; older pending calculations must be refreshed using the whole-recipe loss basis before approval, through manager review edits or PIC revision after return. Migration 157 adds Ingredient Master GradeNature and preserves existing recipe and Opportunity calculations.


Direct price can also be selected explicitly in the sheet price dropdown. Opening an editable sheet checks current pricing without saving it; selecting an ingredient or changing ratios/loss rechecks Auto pricing against buffered quantity. Explicit manual prices and vendor selections are retained. Choosing it leaves the amount blank until entered; a blank direct price cannot satisfy Price Ready. Returning to Auto or a master price clears the override and refreshes the pricing preview. New/edited pricing masters immediately refresh the quote using buffered quantity; a non-applicable selected tier retains its vendor/master link and explains the minimum/maximum quantity or effective-date problem. These changes do not add SQL fields.

Runtime troubleshooting: body.GradeNature or DirectPricePerKg/DirectPriceCurrency extra-input errors indicate an older API model. Stop previous API process trees and start the matching core from the deployed checkout; run one API parent on port 8000. `python tests/python/npd_runtime_contract.py` checks the actual HTTP validation models using deliberately invalid base units/ratios, so it makes no business writes. It complements the in-process rollback contracts.


Recipe price selection ranks effective applicable tiers by required buffered base-unit quantity minus MOQ (closest non-exceeding MOQ first), then USD unit price, latest effective-from date and ID. Explicit vendor-price choices remain selected. The calculator icon opens a sortable quote list when multiple matches exist; one match shows Edit price, while missing prices allow direct entry and Add price. Direct rows allow an optional active vendor with the existing authorized Add/Edit Vendor master controls. DirectVendorID is captured in existing JSON fields; no SQL migration is required. Approved snapshots stay unchanged.

Currency displays use two decimals; weights use three. Inputs and calculations retain their full stored precision. Calculate pricing performs an unsaved server preview: it refreshes currently applicable tiers and recomputes buffer quantities, costs and losses. Save sheet recalculates and validates before storing; Calculate pricing does not save or approve a sheet.


Recipe Request items expose their latest Sheet status and approval status separately. Pending sheets appear as Submitted in Review/Stage: PIC assignment is hidden and managers can open the Sheet through Review to Approve or Return it. Both item-list and request-detail views use the same state rule. Returned open items allow assignment again; approved/closed items keep the captured PIC and display the approver separately. A new revision reopens work. Assignment and submission serialize on the Request Item row; pending or closed/approved items are rejected by the assignment API even from stale pages. These are API query and UI changes, with no SQL migration.


Managers with Recipe Sheet edit access may modify submitted Pending sheets without taking over the PIC. Save changes keeps approval Pending and captures updated lines, FX and calculation without publishing. Approve accepts optional Changes (including the same RowVersion), validates the current recipe and applicable prices, and saves and publishes in the same transaction. Pending recipe status stays Price Ready or Final. Invalid recipes, stale versions or publication failures roll back; only the assigned PIC can edit Draft/Returned sheets, and approved sheets remain immutable. Review edits record UpdatedBy and audit SaveReview separately from ApprovedBy and the assigned PIC. Approval without edits still checks the submitted price fingerprint; exact decimal values compare equally despite SQL decimal scale differences. No SQL migration is needed.
# Recipe Sheet list filters

Recipe Sheets uses the transaction list panel, compact columns, sortable headings,
and server pagination. PIC matches the assigned username prefix. Status can filter
the recipe status (Draft, Price Ready, Final) or approval result (Pending approval,
Approved, Returned). Filters apply before pagination and to the matching total.
Users outside NPD still see only approved sheets, including when filtering.


## Approved links and version history

The Opportunity Linked Recipe Sheet always uses the currently approved sheet,
including for administrators and NPD users. Creating, saving, submitting or
returning a revision does not replace that link or publish new seasoning values.
With no approved sheet, the Opportunity link remains blank. Approval replaces
the active link and publishes the recipe atomically.

Each Recipe Request item shows its Recipe Sheet versions, newest first, with
recipe status, approval status and approver. The current approved version is
marked separately from working revisions. Existing access rules apply: NPD may
open working versions; users outside NPD can view approved versions. Historical
approved sheets retain their captured calculation and remain readable.


## Copied defaults in TCB

Recipe Info shows approved-sheet details through the Notes icon beside its title.
Copied Seasoning price and ratio use a pale blue highlight. A manual TCB edit
clears that field's highlight and persists as an override for the same source
sheet; the other field continues to use its approved default. The source sheet
and its approval remain unchanged. A newly approved sheet supplies new component
defaults and resets overrides from the previous sheet. Seasoning contribution
retains its captured cost basis, so finished-product prices are not multiplied
by the ratio again. The corresponding Process Loss default is highlighted too;
manual loss edits remain item-owned, including if equal to the former default.
Provenance and overrides are stored in the existing TCB JSON; no SQL migration.


## Seasoning scope by captured Level 1 grade

NPD may remove captured raw-grade lines that are not involved in seasoning, and
restore them while editing. At least one unique captured Level 1 grade must
remain; new or substituted grade identities are rejected. Recipe ratios still
total 100%. The Recipe Sheet uses the retained captured grades' share of estimated awarded
order MT for ingredient quantities and buffered pricing tiers. A 10 MT order with
60% Cashews uses 6 MT when only Cashews are retained. The share comes from the
captured Product Grades, not from the editable recipe ratios.
Comparisons of raw proportions normalize only the retained captured grades.

Approval captures ApplicableGradePaths from the retained raw rows. Only matching
Level 1 grade families may select a process mapped to the Seasoning component,
and receive its approved price, ratio and Process Loss default. Other grades
retain their own RM and process settings. Draft, pending and returned revisions
do not change the currently approved scope. Optional products without an approved
sheet may still enter Seasoning manually; required products need confirmation.

Seasoning is never an All-grades process and its Shared master flag does not
couple unrelated families. Packing remains common. Current saved legacy global
Seasoning is projected onto its eligible grade families on read and when applying
approval; formula references are remapped by process identity and excluded-grade
Seasoning terms become zero. Historical TCB versions remain captured. Scope and
normalization use the existing JSON documents and require no SQL migration.


## Recipe Request list layouts

Recipe Requests and their Items have independent per-user layouts stored under
`recipe_requests.header` and `recipe_requests.items` in the existing workspace
preference JSON. Layout controls configure visible columns, column order, column
widths, filters and records per page. Sort controls support multiple prioritized
rules; header clicks sort directly and Shift-click adds a rule. Reset restores
the default layout and clears applied filters. Save layout to profile retains
both the view and its filter values across sign-in sessions.

Request filters cover reference, Status, Created by and Assigned to. The server
filters and sorts the entire authorized request list before pagination. Item
filters cover Product/comments, PIC and Stage; sorting (including numeric MT)
and filtering operate on all loaded request items before pagination. The item
field-group tabs further restrict the visible columns without losing the saved
layout. Required Request/Items and Review/Product columns retain entry points.

The Review cell keeps the status, PIC selector and save action on one line with
no nested scrollbar. Submitted sheets still lock PIC and expose the existing
manager review action. Layout settings do not change assignment or approval
permissions. No SQL migration is needed.
