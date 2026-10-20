# Process-grade costing

Process is a versioned Product-grade / Opportunity-grade-tree flag. It is not a Raw Grade Master property and does not change supplier prices.

- A Process node owns one seasoning/oil/RM-ratio/processing recipe, keyed by that node's grade path.
- All final raw-grade descendants retain their individual quote or direct-price selections and composition ratios. Quote/direct-price controls are in an aligned Pricing column inside the TCB grades tree, next to Raw Material. Direct price and its amount are together on the card's top line. The separate Process Info table contains only Process nodes, summarized RM USD/lb and Line product USD/lb, their product ratios, and the shared recipe inputs directly in the same row (no expander or separate detail row). It never repeats raw child pricing rows. Raw-only grades still have tree pricing but do not appear in Process Info.
- A descendant cannot be Process while an ancestor is Process. Its checkbox is unchecked and disabled.
- Unprocessed final grades contribute their raw cost directly; no seasoning/oil/processing recipe is applied.
- Process may also be selected on a final grade with no children.

## Compact review layout

Grade, Raw Material and Pricing cards share a measured height and equal column widths in TCB. Connection lines follow final grade to material to pricing, including direct final roots; stacked narrow-screen panes omit horizontal links. Raw codes appear beside the Raw Material label and dropdowns show material descriptions. A refresh icon in the Product header loads pricing for changed grades, retaining its original validation and disabled states.

TCB versions sit beside the item title; the current published approach is labeled Active. Grades and pricing are always visible, without a nested vertical scroll panel. Desktop Process Info uses a width-fitted inline table; narrow screens reflow its fields into labeled cards instead of clipping values. Grade and pricing panes stack on narrow screens.

Business editor typography uses shared page-title, section, subsection and minor-heading sizes (22px editor titles, 16px sections, 14px subsections, 13px minor headings). Product Loss, Process Info and Packaging share the section level. Calculations, permissions, version activation and save contracts are unchanged.

## Calculation

Group RM USD/lb = sum(child raw USD/lb x child's final product proportion) / Process group's final product proportion.

Group product USD/lb = Group RM x RM ratio / 100 + Seasoning USD/lb x seasoning ratio / 100 + Oil USD/lb x oil ratio / 100 + Processing USD/lb.

Overall product USD/lb = sum(Process group product USD/lb x group proportion) + sum(unprocessed raw USD/lb x final proportion).
The overall RM summary remains the weighted raw-material cost before processing. Group child Ratio values are within-group proportions; the Process header shows the group's product proportion.

Example: a Process group is 60% of the product. It contains 25% raw A at $2/lb and 75% raw B at $4/lb. Blended RM is $3.50/lb. With RM 90%, seasoning 10% at $1/lb, and processing $0.20/lb, the group costs $3.45/lb. A separate unprocessed 40% at $8/lb yields overall RM $5.30/lb and Product $5.27/lb. Child processing costs are not added again.

## Unsaved changes and persistence

Enabling Process on a parent temporarily suppresses descendant Process flags and recipes in the editor, without deleting their draft settings or raw-price selections. Unchecking the parent before Save restores those settings. A new Process parent starts with a default 100% RM, zero-addition recipe; switching back and forth also retains edits to the parent recipe.

Preview and Save send only applicable recipes and normalized flags: a Process ancestor forces descendant Process flags false. After a successful save, the server returns only the applicable recipes, so suppressed child settings no longer restore. Preview does not discard the browser's hidden draft settings. Existing stage, Packaging Request grade locks, rowversion checks and version isolation remain in force.

Migration 137 adds nullable ProductGradeItem.Process, updates Product grade-save validation, and carries the flag into future Opportunity/PCR snapshots and Product copies. It never rewrites existing documents or TCB history. Legacy snapshots without explicit Process values retain previous per-leaf processing, exposed as checked leaf Process boxes when edited. New grade nodes default to Process off.

The server validates saved tree exclusivity, preserves per-leaf quote validation, captures one MaterialCostSnapshot per Process group, and rejects invalid/unknown recipe paths. Applicable recipe filtering does not remove raw-price selections.

## Verification

Current-schema database tests are rollback-only:
- grade_process_contract.ProcessMath
- grade_process_contract.ProcessPersistence
- grade_process_contract.ProcessVersion

UI/model regressions cover a multi-child shared panel, raw siblings, unchanged quotes, disabled child checkboxes, toggle restoration, save cleanup, numeric grade-path ordering and per-item TCB versions.
