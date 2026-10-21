# Grade Process Loss and Recipe Info

TCB Review keeps Grades & pricing open, followed by **Process Loss**, then
**Recipe Info**. Initial Design has a plain label; its currency selector remains
beside the amount.

## Process Loss

Loss types define shared L1, L2, etc. codes without a global ratio. Each effective
Process grade has its own row containing one percentage per loss code, a formula
and the calculated loss percentage. One calculator in the Loss (%) table header
tests all active rows together. Loss types cannot be selected more than once;
remove or change any duplicates already present before saving. A child
under a Process parent cannot also be Process. Dormant child recipes and losses
remain in the browser when toggling the parent; only active rows are saved.

Formula variables L1, L2, etc. are decimal ratios (10% is 0.10), and NW is the
Opportunity item's net weight in grams. A blank formula compounds sequential
yields. Formula testing is read-only and uses the existing server formula parser;
clients cannot supply calculated loss percentages. Ratios, formula or NW changes
invalidate a previous result. Analysis rechecks custom formulas before showing
draft costs. Loss must be below 100%, with nonnegative ratios of up to two decimals.

## Recipe Info

Every grade level appears in natural path order with its local grade ratio,
including non-Process parent roll-ups and raw-only leaves. Only Process grades
maintain recipe inputs. Children contribute raw costs to their Process owner;
Processing is charged once on that owner's recipe, not on every child.
Only Level 1 rows are visible by default; expand each grade to reveal its children.
Level 1 families use alternating gray and white backgrounds. Line RM shows both
prices before loss and highlighted loss-adjusted prices on parent and child rows.

- Adjusted raw price = raw USD/lb price / (1 - owning Process loss / 100).
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

Inputs.ProcessLosses stores grade paths, loss ratios and formulas in the existing
TCB JSON. ProcessLossSnapshots captures server results. Active and inactive
versions, copy, reopen and activation use the same calculation path. Historical
documents without ProcessLosses retain their previous overall-loss calculation
until Process Loss is edited; no bulk financial backfill occurs.

Deploy matching core source and the rebuilt webapp/dist, restart the API and
hard-refresh clients. This change needs no new SQL migration beyond the existing
grade/version prerequisites (through 137). Migration 138 remains required for the
separate shipment customer-currency update.

Checks: grade_process_loss_contract.py, grade_process_contract.py,
tcb_analysis_columns_contract.py, grade-process-loss.spec.ts,
opportunity-losses.spec.ts and tcb-versions.spec.ts.
