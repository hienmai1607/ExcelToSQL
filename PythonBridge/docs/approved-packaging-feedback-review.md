# Approved-only packaging feedback (149)

Applied to desktop test after the user approved migration 149 and the matching API changes.

The former shared packaging view preferred an open response over an approved response. Opportunity readers allowed Admin/Packaging draft visibility, and TCB independently selected the latest open response. A new pending request could therefore displace the prior approved source.

## Current behavior

- Opportunity packaging results come from the latest Approved response for that item.
- If none is approved, response results stay blank.
- Assigned, Working, Returned, Pending Review and Canceled responses do not replace earlier approved results.
- Approving the later response publishes its results.
- Opportunity grid, Excel and TCB use the same approved source, including prices, pallet snapshots, container proposals and capacities.
- Draft preview remains available inside the Packaging Request editor.
- Workflow badges and assignment status continue to show the latest request, independently of the approved results.
- Saved business data, pricing snapshots, approvals and history are not rewritten.

## Implementation and deployment

`sql/149_approved_packaging_feedback.sql` alters `dbo.v_OpportunityItemPackaging` after migration 148. It selects only Approved responses, ordered by descending response ID. `core/opportunity_views.py` removes the role-based draft override from published results and filters parent/child response joins to Approved. `core/tcb_api.py` reads the same shared publication view.

Migration 149 was applied and rerun on desktop. Full hashes of all rows in nine Opportunity, request, pricing, pallet and container tables remained unchanged. API source changes require an API restart; browser refresh then retrieves the corrected results.

For VM: back up the database, stop the API, apply 148 if needed and then 149 in the application database, deploy the matching API files, restart the API and refresh browsers. The previously published 142-147 bundle does not contain 148 or 149. This change also applies to legacy consumers of the shared publication view.

## Verification

`python -W ignore tests/python/approved_packaging_feedback_contract.py` now runs against the actual database view and current API readers. All three scenarios pass for Admin and Opportunity users: no approval, retention of older approval throughout nonapproved states, and later approval. Checks also cover TCB source selection and request-editor draft visibility. Each test rolls back fixtures, verifies original response stages/rowversions and Opportunity data, and verifies removal of cloned requests/items/users.

Before the fix the same test reproduced 16 state/role assertion failures. The proposed queries were verified without applying them; after explicit user approval the migration and API fix were applied and the tests rerun without query mocks.

The related live audits also pass: 309 Opportunity replica checks, 280 reference/manager checks and 233 Mix/floor checks. All report cleanup complete and original records unchanged. The Mix/floor audit now checks draft proposal eligibility inside the request editor and publication only after approval.
