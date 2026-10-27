# Packaging load proposals and Mix units

- Changing the selected base pallet or maximum loaded pallet height clears both prior counts and obtains fresh payload-limited Cartons/layer and Layers/pallet proposals. Users can then override either count. Missing geometry is not replaced by stale counts.
- Removed the pallet weight-preview note.
- Floor load and Both show proposals for all five active container types; the requested type must remain proposed. Each proposal uses carton shipping dimensions, gross weight, maintained internal dimensions, door opening, clearance and maximum payload. The shared bounded upright-carton packing algorithm allows 90-degree footprint rotation. These are best feasible arrangements found, not a claim of globally optimal 3D packing or permission to lay cartons on their sides.
- Each container has an independent manual count. Proposals and their rotation/zoom 3D preview are combined inside the existing Container Load 3D icon view, not shown as a separate table in the response. Both retains the pallet/floor mode switch. Users may apply a proposal or a lower manual count. Above-proposal counts are blocked on save and confirmation using captured server-side response geometry and weights. Manual changes detach stale plans for that container only. Missing geometry may remain in an incomplete draft but blocks confirmation.
- A Mix child's final-package smallest-unit count is the product of its active packing quantities. It must divide the parent's captured ProductMixSnapshot quantity exactly. For quantity 6, final packages may contain 1, 2, 3 or 6 units; 3 Primary / 2 Secondary / 1 Tertiary is valid. No current Product master fallback is used. Existing maximum-four-layer and minimum-one-parent-layer rules remain unchanged.
- The UI checks each changed child before review. API batch and family submission/approval checks prevent client bypass; a rejection rolls back the whole save. Same config does not bypass the child-specific quantity rule.

## Desktop testing

Restart the API and hard-refresh the browser (Ctrl+F5). The original load/Mix changes use the four-layer schema; Proposal checkboxes now require migrations 146-147. See [container proposal deployment](container-proposals-146.md). No original business data is rewritten.

## Verification

Focused browser tests cover fresh pallet proposals, manual counts, container switching, 3D preview and responsive footer access. Python contracts cover divisors, compounded quantities, footprint/payload limits and doors/clearance. Rollback-only desktop integration tests exercise invalid Mix and floor saves, verify unchanged rowversions after rejection, and compare controlled TCB results with an independent Decimal oracle. All replicated records are removed by rollback and originals are hash-checked.
