# Opportunity replica audit - 23 October 2026

## Result

Both requested business scenarios pass after three application fixes. The final
desktop SQL audit completed **309 checks**. All 56 populated TCB Analysis cells
for the replica of OPP-2026-10075 match the source, with no differences. All 84
TCB Analysis cells in the controlled OPP-2026-10094 Mix case match independent
Decimal calculations. Numerical comparison tolerance is USD 0.000001.

The audit rolled back every test write. Its explicit record-ID manifest is
empty after rollback, and hashes of the original records it read are unchanged.
Original opportunities, master data, approved responses and saved plans were not
edited or recalculated.

## Method and boundaries

- Ran on desktop DESKTOP-5BGMJSC, database `test`, through the real Python API
  handlers, validation and SQL procedures. This was not a mocked costing test.
- Used one externally owned transaction so each normal handler could save and
  read its records, while final rollback removed the whole test family, including
  generated versions, pricing snapshots and audit records.
- Used existing authorized Admin and Packaging PIC identities; no users or
  permissions were changed.
- Browser tests separately exercise the UI with intercepted API fixtures. This
  is not a claim that the two live-data workflows were clicked end-to-end through
  browser authentication/HTTP, nor a visual comparison of every screen field.
- Business inputs, remapped linked IDs, captured TCB inputs, process-loss results,
  packaging prices, loading quantities and all 28 TCB Analysis output columns
  were checked. Generated IDs/codes, QA-prefixed names, timestamps and rowversions
  intentionally differ.
- Canonical currencies, UoMs, markets, container specifications, Process Types
  and the named system Pallet type/dimension were reused read-only. Related
  editable business masters were duplicated instead of altering the originals.
- No new SQL migration was needed. Opportunity final closure/customer award was
  not performed: both reference opportunities are Draft. Packaging responses
  were submitted and approved, and TCB settings were saved/read back.

## OPP-2026-10075: reference replay

1. Read the two original items, their captured grade trees, shipment settings,
   saved TCB inputs and approved packaging responses 2021298 / 2021299.
2. Created a separate Customer, Products, Raw Grades, Raw Materials, Raw Prices,
   Vendors, Packaging Types, Dimensions, Materials, Prices and Port as needed.
3. Created a new Opportunity and two items through the standard batch handler.
   Checked the copied header and supplied item business fields after saving.
4. Created a Packaging Request, assigned a valid PIC and moved it to Working.
5. Replayed five packaging pricing calculations using the new master IDs and
   current rowversions. Previewed/revalidated fingerprints, then saved them.
6. Saved pallet assemblies and replayed the two selected load plans. Their
   carton capacities match the reference: 972 and 1,080 respectively.
7. Submitted both responses for review and approved them.
8. Saved each item's remapped TCB inputs, compared every captured input, checked
   RM/product costs and per-grade losses, and compared all 28 Analysis columns
   per item through the Opportunity grid read path: **56/56 match** (none blank).

Old VND packaging quotes without their own exchange-rate snapshot were cloned
using the reference Opportunity rate of 25,000 VND/USD. The resulting prices and
TCB outputs match; no source quote was updated.

## OPP-2026-10094: independent controlled Mix

The original is a Draft Mix with three 396.89 g children and no packaging
responses or saved TCB results. There is no completed original result to compare
against. A separate test copy used deliberately unequal quantities **2:1:3**.

- Mix net weight: 2,381.34 g. Annual parent units: 1,000; child annual quantities:
  2,000 / 1,000 / 3,000; estimated award: 50%.
- Raw prices: USD 1 / 2 / 3 per lb; Sorting loss: 10% / 20% / 0%; common Packing
  loss: 1%. Manual formula: `1-(1-L1)*(1-L2)`.
- Each Level 1 recipe uses RM 90%, seasoning 5% at USD 0.20/lb, oil 5% at USD
  0.30/lb and Processing USD 0.10/lb. Loss adjusts RM before this recipe.
- Child bag: USD 0.10, tare 0.01 kg; child carton: USD 1, tare 0.20 kg, 10 units.
  Parent Mix box: USD 0.60, tare 0.05 kg; parent carton: USD 1.20, tare 0.40 kg,
  four Mix units. All four responses were priced, saved, submitted and approved.
- Maintained child-specific Packing, Design, Fixed cost, Interest and Margin;
  allocated parent packaging and logistics by child quantity. Checked each
  packaging layer's loss independently, destination costs and fee gross-up.
- Checked pallet/container rectangle bounds and non-overlap independently,
  vertical layer counts, units/cartons, net and gross weights.

| Check | Expected and actual |
| --- | ---: |
| Cartons per pallet | 2 |
| Mix units per pallet | 8 |
| Pallets / cartons per 20DC | 10 / 20 |
| Container net weight | 190.5072 kg |
| Container gross weight | 366.9072 kg |

| Child | Quantity per Mix | Recipe USD/lb | FOB USD/unit | DDP USD/unit |
| --- | ---: | ---: | ---: | ---: |
| A | 2 | 1.1351010101 | 4.9842797276 | 9.3902279403 |
| B | 1 | 2.3977272727 | 6.8088616901 | 11.4708399523 |
| C | 3 | 2.8522727273 | 7.0146446755 | 11.7054989373 |

All **28 output columns x 3 children = 84 cells** match the independent oracle.
No application costing helper was used to calculate the oracle's expected costs.

## Application defects found and fixed

1. **Decimal-text AnnualUnit failed the legacy INT TVP.** Reading 50,000 units
   from SQL gives `50000.0000`; passing that text to the INT TVP caused SQL error
   245. Whole Decimal quantities now serialize as integer text, without changing
   the existing fractional Mix quantity handling. Added a real SQL regression.
2. **Mix gross weight counted a whole child carton for each child unit.** The
   controlled case returned 2,211.072 kg instead of 366.9072 kg. Child final-carton
   gross is now allocated over its primary-unit count (and tertiary factor for
   three layers). Fixed server and browser preview, with two/three-layer,
   missing-count and live child-edit regressions. Unknown weights stay unknown;
   explicit zero remains zero.
3. **Missing Mix composition fabricated efficiency from parent weight.** A Mix
   without its captured composition could produce 22,500 kg/m3 from the parent's
   weight and packing counts. Server and UI now keep Mix efficiency unknown when
   the captured composition is missing. Existing failing math regression and a
   new browser regression both pass.

Existing stored load plans are immutable snapshots; they were not silently
rewritten by these fixes. A future edit must explicitly recalculate/save a plan.

## Cleanup

The final audit tag was `QAc4418e63`. Its manifest covered 95 explicit IDs:
2 Customers, 6 Products, 11 Raw Grades, 8 Raw Materials, 7 Raw Prices, 2 Vendors,
8 Packaging Types, 8 Dimensions, 10 Packaging Materials, 10 Packaging Prices,
1 Port, 2 Opportunities, 6 Opportunity Items, 2 Packaging Requests, 6 Responses,
3 Pallet snapshots and 3 load plans. Generated dependent records were in the same
transaction and rolled back as well. Both `cleanup` and `originalsUnchanged`
checks returned true. SQL identity/sequence gaps from rolled-back allocations
are normal and were not reset.

## Verification and remaining test-suite limitations

- `python tests/python/opportunity_replica_audit.py --quiet`: 309 checks pass.
- Focused Python regression selection: 81 tests pass, covering quantities,
  nested gross weight, Mix efficiency, child-only costs, recipes, TCB Analysis,
  loading calculations and net weight.
- Current browser selections: 157 tests pass (116 cross-workflow tests plus 41
  current TCB Review tests), covering Opportunity creation, inline Mix creation,
  Mix workflow, packing, request families, process loss, recipes, Add/Edit Master,
  save validation and Analysis.
- Production TypeScript/Vite build passes; existing large-bundle warning remains.
- Broader legacy SQL selection is **not green**: 45 setup errors replay older
  migrations whose order constraints exclude current Pallet/Mix orders. These
  setup transactions rolled back. The live-schema audit does not replay those
  obsolete definitions and passes.
- Older `webapp/tests/tcb.spec.ts` is **not green**: eight assertions encountered
  expect the retired Process Info table, automatic parent/child Process exclusion,
  old recipe ownership or old labels/counts. Do not interpret this report as a
  clean full-repository test run. Current Level 1 recipes and simultaneous
  parent/child processing are intentional requirements, not reverted to satisfy
  those expectations.
- One inline-Mix test fixture was refreshed with an active gram UoM; its previous
  empty UoM catalog correctly prevented Product confirmation. All eight tests in
  that file now pass.

The reusable audit is in `tests/python/opportunity_replica_audit.py`, restricted
to the desktop `test` database. Re-running it creates new tagged temporary copies
and always rolls them back, including on failure.
