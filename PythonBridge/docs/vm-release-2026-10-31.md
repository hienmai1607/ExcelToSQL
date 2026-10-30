# VM release — 31 October 2026

This release follows commit b7551a6 and requires the database to be current through migration 153. No additional SQL migration is required.

## Deployment

1. Copy the complete updated `core/` folder, including the new `tcb_snapshot_costs.py` module, and the complete `webapp/dist/` folder to the VM. Preserve the VM's existing environment, authentication settings and service configuration.
2. Restart the API service and all its workers.
3. Hard-refresh the browser with Ctrl+F5.

The regenerated `deployment/company/release-files.sha256` records the release file hashes.

## Included changes

- TCB parent/shared Packing cost, Processing with Loss and RM totals weighted by recipe RM Ratio.
- FOB, CFR and DDP in USD/customer currency, with rounded-up final-carton totals and shared Mix cells.
- Frozen headers in Analysis, Compare TCB versions and Compare opportunity items.
- Packaging Summary pricing in VND / USD for VND-sourced pricing, otherwise USD only.
- Floor load and Both allocate floor-load cost only, excluding pallet cost. TCB shows the corresponding Floor load cost (USD/MT) rate.
- Created by filters on both lists; Assigned to filter and Assigned to me item count on Packaging Requests.
- Separate PIC and Approved by labels in request item review and the request editor.

## Verification

Final release checks passed: 77 browser/model tests, 80 focused backend contracts, one desktop save/reopen rollback contract and the production build. The four-item end-to-end Mix/standalone workflow also passed 214 checks in a rollback-only run. Desktop SQL/HTTP checks verified user-specific assignment counts and the distinct PIC/approver on PCR-33493. Legacy test limitations are documented in `opportunity-request-ownership-filters.md`.
