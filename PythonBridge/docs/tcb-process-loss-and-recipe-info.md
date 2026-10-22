# Grade Process Loss and Recipe Info

TCB Review keeps Grades & pricing open, followed by **Process Loss**, then
**Recipe Info**. Initial Design has a plain label; its currency selector remains
beside the amount.

## Process Loss

**Process Types** (formerly Loss Master) defines names such as Sorting,
Roasting and Packing. The separate **Loss Process Master** stores one default
percentage per exact Raw Grade + Process Type. Maintain an **All grades / Packing**
entry for the final common Packing stage. Existing values are not invented or
backfilled by migration 141.

The Process Loss table has one row per processing grade's complete path. Its own
processes come first, then inherited parent processes and common Packing. L1, L2,
etc. label aligned columns shared by all rows. Each parent's codes follow the maximum child code count; Packing is always the final column. For example, three child codes plus two Cashew codes put Cashew Roasting at L5 and Packing at L6 for every relevant row. Missing cells are zero-valued formula variables, not additional processes. Select each type only once per source stage.

The first column is Process Code. Type and percentage are compact inline controls; source grade details appear on hover. Desktop rows are compact, and narrow layouts wrap cells with their L-number labels rather than introducing a table scrollbar.
Both child and parent Process ticks may be active. Source stages flow into a
processing parent after blending; all Level 1 branches connect to one final
Packing source. With only the parent ticked, children blend first and share that
parent's row and formula. With children also ticked, their rows include shared parent values; the parent is not charged again. Unticked branches still reach Packing.

Grade-specific defaults prefill new stages. They are copied into the TCB JSON;
later master changes never overwrite saved user values. Inactive versions keep
their captured values rather than adopting current defaults. One calculator in
the Loss (%) table header tests every grade's complete formula in one
read-only request. Dormant stages remain in the browser when unticked, but only
active stages are submitted.

Process Types retains its Shared checkbox. For stages selecting the same Shared
type, maintain its percentage on the first stage; later stages display the copied
percentage read-only. Other types and formulas remain grade-specific.

Formula variables L1, L2, etc. are decimal ratios (10% is 0.10), and NW is the
Opportunity item's net weight in grams. A blank formula compounds sequential
yields. Formula testing is read-only and uses the existing server formula parser;
clients cannot supply calculated loss percentages. Ratios, formula or NW changes
invalidate a previous result. Analysis rechecks custom formulas before showing
draft costs. Loss must be below 100%, with nonnegative ratios of up to two decimals.

## Recipe Info

Every grade level appears in natural path order with its local grade ratio,
including non-Process parent roll-ups and raw-only leaves. Recipe fields belong
to Level 1 grades only, independently of Process flags. Children contribute their
loss-adjusted raw costs to Level 1; Processing is charged once on that Level 1
recipe, not on every child. An unambiguous old child recipe carries up to Level 1.
If saved child recipes differ, review the Level 1 recipe before saving.
Only Level 1 rows are visible by default; expand each grade to reveal its children.
Level 1 families use alternating gray and white backgrounds. Line RM shows both
prices before loss and highlighted loss-adjusted prices on parent and child rows.
The two RM prices share one compact line. Loss Process % on a blend is implied
by its unrounded weighted RM costs: `100 * (1 - RM without loss / RM with loss)`.
It is not the arithmetic average of its child loss percentages. Identical child
losses can still display without prices; different losses need complete RM costs.

- Adjusted raw price = raw USD/lb price divided once by (1 - the grade's calculated loss).
  Its manual formula includes its own, parent and Packing percentages. For example, W210 can use Sorting L1, shared Roasting L2 and common Packing L3: `1-(1-L1)*(1-L2)*(1-L3)`. Parent and Packing yields are not applied again.
- Line RM = sum of adjusted child raw prices times their within-parent ratios.
- Line product = RM times RM ratio + seasoning times seasoning ratio + oil times
  oil ratio + Processing USD/lb. RM, seasoning and oil ratios must total 100%.
- Non-Process ancestors sum child Line RM and Line product using local ratios.
- Total RM w/o Loss ($/lbs) sums raw prices weighted by grade ratios before loss.
- Total RM with Loss ($/lbs) and Total Product with Loss ($/lbs) sum the respective
  loss-adjusted Level 1 line costs times Level 1 ratios.

New per-grade losses are applied to raw material only, never again to the final
product cost in Analysis, grid columns or workbook calculations. Monetary display
rounding does not replace calculation inputs.

## Persistence and deployment

Raw Material and Pricing controls offer permission-aware Add Master actions.
All supported inline master dropdown controls switch to Edit Master when selected,
using the cube-and-pencil icon; empty selections keep the cube-and-plus Add action.
Shortcut editing uses the same master editors, permissions and normal save handlers
as Master view. References do not prevent opening the editor: existing validation
and blocking rules run when saving in either view, not through a shortcut-only FK
block. Any future reference policy must be added to the shared master save path.
Historic JSON captures are never rewritten. Shared parent fields (such as a material's
Grade or a price's Material) remain locked. No additional SQL migration is needed.
Raw Material creation defaults and locks the linked Grade; Raw Pricing creation
defaults and locks the linked Material, and defaults Price UoM from that material.
After creation, choices refresh and the new record is selected without saving
the TCB draft. A failed refresh can be retried without recreating the master.

Inputs.ProcessLosses stores grade paths, per-stage Codes and source percentages
in the existing TCB JSON. Path 0 is the common Packing stage, not a real grade.
Inputs.ProcessLossLayout=Aligned reserves consistent L-number positions for inherited processes and Packing. Older row-local formulas are remapped by their source process when edited or tested; saved results remain valid when only their variable positions change. Adding or removing a source also remaps references without silently changing which losses a formula uses.

Inputs.ProcessLossMode=GradePath selects complete-path calculation; Inputs.ProcessLossFormulas maps grade paths to manual formulas. Legacy documents without this mode retain stage calculations until editing or testing explicitly combines their formulas. Legacy rows without Codes still use captured global codes. ProcessLossSnapshots
captures resolved L1/L2/etc. percentages, the complete formula and server result per grade. Active and inactive
versions, copy, reopen and activation use the same calculation path. Historical
documents without ProcessLosses retain their previous overall-loss calculation
until Process Loss is edited; no bulk financial backfill occurs.

Deploy matching core source and the rebuilt webapp/dist, restart the API and
hard-refresh clients. Apply sql/139_shared_loss_types.sql after migration 138
before deploying the matching API. Migration 139 is rerunnable, preserves the
existing permission logic, and defaults existing Shared flags to false without
rewriting saved TCB JSON. Migration 138 remains required for shipment currency.
Apply 140 for Mix child Others Info, then 141 for grade/type loss defaults and
nested processing. Restart the API and hard-refresh after deploying matching
source and rebuilt webapp/dist. The complete-path table requires no additional SQL migration. The grade-edit save path now validates recipes
against Level 1 grades rather than against the independent Process owners.

Checks: grade_process_loss_contract.py, grade_process_contract.py,
tcb_analysis_columns_contract.py, grade-process-loss.spec.ts,
opportunity-losses.spec.ts, process-flow.spec.ts, grade-loss-master.spec.ts,
process_graph_contract.py and tcb-versions.spec.ts.
