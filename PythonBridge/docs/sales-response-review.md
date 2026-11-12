# Sales acceptance of Packaging and Recipe responses

Manager approval sends a response to **Awaiting Sales**. It remains open and does not replace the Opportunity's currently accepted result. The original request creator, with Opportunity edit access, or Admin can review it from the Opportunity's Packaging Request or Recipe Request tab.

- **Accept response** requires confirmation, publishes the captured result and closes the request item. Packaging accepts the whole parent/child family atomically. Recipe acceptance links the approved sheet and publishes its seasoning inputs to TCB.
- **Return response** requires a note and confirmation. It retains the current Opportunity result and PIC, reopens the response for revision, and requires team submission and manager approval again before Sales can accept it.
- Submitted or manager-approved responses cannot be reassigned while awaiting review. Other Opportunity viewers can inspect manager-approved results without decision buttons.
- Row versions protect every family member against stale or partial acceptance. Sales decisions record the actor, time and note separately from the manager's approval.
- Packaging Request now contains the clickable Packaging response and Sales review; the separate Opportunity Packaging Responses tab is removed. Packaging's own workspace remains available.
- Pending Sales reviews show a PCR link to the read-only Packaging Request, or RRQ and RCP links to the read-only Recipe Request and Sheet. The arrow opens the Sales decision controls. Accepted reviews show only the Accepted badge; the current linked record columns retain the accepted result until a replacement is accepted.

## Existing results and deployment

Migration **159_sales_response_review.sql** requires migration **158**. Its first run marks existing manager-approved Recipe Sheets as Sales accepted. Existing approved Packaging responses remain accepted. It does not republish or recalculate their captured data, and rerunning it does not auto-accept later responses.

Migration 159 also changes the shared Packaging manager transition to Awaiting Sales while retaining the existing permissions, completeness checks and family workflow. Apply SQL and application files together; stop the API before upgrading the VM, back up the database, apply 158 first if needed, apply 159, copy `core` and `webapp/dist`, restart the API and refresh the browser.

Migration 159 is applied to the desktop test database. VM deployment is not performed by this change.

## Verification

`tests/python/sales_response_review_contract.py` exercises the desktop database with rollback fixtures: manager approval withholding publication, requester/Admin permissions, stale decisions, preservation of an accepted recipe during replacement, family acceptance, Sales return and resubmission.

`webapp/tests/sales-response-review.spec.ts` checks the merged tab, complete family preview, explicit confirmation, required return notes, preservation of the previous Recipe link and read-only viewing.
