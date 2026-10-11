# Item Stage Summary

Opportunity details now has a read-only Stage Summary tab. It shows every saved
item and mix child, even when children are collapsed in the other grid tabs.
Product Info no longer has a TCB calculator launcher; use TCB Review.

The horizontal stage track maps existing saved data:
- Initial (saved Draft status) and Product Review: Product Info / Packaging requirements; Product Review checks saved required fields, not
  a new recorded approval.
- Packaging requested: current/latest request. PIC Assigned requires a PIC,
  or Working as evidence that assignment was reached.
- Review Submitted: Pending Review, with saved submission timestamp.
- Review result: Approved or Returned. Rejected uses Canceled as confirmed.
- Canceled requests show their audit reason and a return to Product Review.
- Customer proposal: Proposed. Customer result: Awarded or Lost.

TCB Entries branches from Product Review and visually rejoins at the new TCB Review milestone before Customer proposal. It is parallel, not a packaging gate. Its indicators show saved inputs,
calculation, Shipment/Logistics/Others, Loss, Grades and Price entries. Saved badges alone do not imply review completion. Child shipment inputs inherit
from their parent; other indicators are item-specific. Blank and unavailable
values remain incomplete. Zero-valued saved prices/calculations count as saved.

Completed TCB Entries independently reach TCB Review unless the item is
Returned, Rejected/Canceled, or canceled. Packaging review remains on its own
track: pending packaging milestones are never marked completed by TCB progress.
TCB Review completes automatically when all 28 saved Analysis outputs are
available (zero is valid; null/blank is incomplete). Its outgoing line then
reaches Customer proposal as ready, without recording that a proposal was sent.
Missing Analysis field names are available on the milestone description.

Mix-parent prices and grades are sourced from all its children, not its own
empty raw-price list. Parent review completeness requires every child's Analysis
and is blocked by a returned/rejected child. Unreached outgoing links are gray;
Returned and Rejected/Canceled outcomes show a red cross and block forward links.

This view does not change transitions, authorization, records or history.
Reasons come from the matching stage-change audit, with ManagerComment as a
legacy fallback; draft response reasons retain existing access restrictions.
No SQL migration is needed. Deploy matching core and rebuilt webapp/dist.

Stage colors follow the numbered reference strip from right to left, starting
with the red-orange bar marked 1 for Initial (not the unnumbered pink bar).
Product Review uses the next orange bar. TCB Entries inherits Product Review
color. The completed merge keeps that color for the first two thirds, then
blends with Review result lime at the junction. Incomplete/blocked
connectors remain gray; workflow readiness rules are unchanged.

Product Review checks Product ID and valid Annual units (zero is valid),
plus Primary Type (or legacy Packaging type) and root-item Pallet size.
Children do not require a separate Pallet size. Optional Shelf price, award
percentage, comments and optional packaging selections do not block completion.
The milestone shows a compact Complete/Incomplete status without an inner
scrollbar. Separate section statuses and missing required fields are on hover. No new approval action is introduced.

Milestone notes use a compact status with a clickable milestone circle and title. Details,
including timestamps and missing fields, are collapsed initially and available
by clicking the milestone or using its keyboard-accessible button. No V controls are shown. TCB Entries save badges and child inheritance explanation
are similarly collapsed; expanding them does not change saved workflow state.
