# VM release - 17 November 2026

Use this release with the existing VM database updated through migration **159**.
Run [upgrade_160_to_163_vm.sql](../sql/deploy/upgrade_160_to_163_vm.sql), which combines:

| Migration | Change |
| --- | --- |
| 160 | Duty % tax-line breakdown (`DutyBreakdown`): Duty % must equal the sum of its lines, total ≤ 100% |
| 161 | Duty % and its lines allow four decimals; Payment term becomes text (`PaymentTerm`, up to 200 characters) |
| 162 | Explicit "Update to current mix version" for saved Opportunity Mix items (procedure plus two guarded trigger patches); see [Mix version update](opportunity-mix-version-update.md) |
| 163 | Deleting a Draft Opportunity item (standalone or Mix family) also removes its automatic empty initial TCB version; see [Opportunity item deletion](opportunity-item-delete.md) |

The migrations change only procedures and triggers; no table data is modified. Saved Mix items change only when a user explicitly updates them. Existing Duty % and Payment term (days) values remain valid. A saved whole-day payment term shows as "N days" text and is stored as text on the next save. The bundle is rerunnable and is **not atomic**: each migration keeps its own transaction. It stops on error in SQLCMD mode.

## VM deployment

1. Back up the application database and keep the current API, compiled UI and templates folders.
2. Stop the API service and all workers.
3. Select the existing application database. Run the script in **SSMS SQLCMD mode** or `sqlcmd -b -S YOUR_SERVER -d YOUR_DATABASE -i upgrade_160_to_163_vm.sql`. Do not run it against a system database. If the VM is older than 159, apply the preceding bundles first.
4. Confirm `Upgrade 160-163 verified. Deploy matching application files before restarting.` If an error occurs, resolve it and rerun before starting the updated API.
5. Copy the complete **core/**, **webapp/dist/** and **templates/** from this commit. Preserve VM environment settings, credentials, service configuration and attachment storage.
6. Restart the API service and all workers. Users hard-refresh browsers with Ctrl+F5 and download fresh Excel Local Update workbooks.

## What users see in this release

- **Duty %** is display-only, with a calculator icon. Users add Tax type and Percentage (%) lines; the sum becomes Duty % (up to four decimals). A legacy Duty % opens as one "Duty" line. Typing Duty % directly in the Opportunity Excel workbook replaces its breakdown.
- **Payment term** is free text (for example "Net 30 after B/L") instead of whole days.
- **Copy icons** in the Opportunity editor:
  - Header Info: add all items of another Opportunity of the same Customer. Mix products get their current children. Products already in the Opportunity are skipped and listed.
  - Each item: copy another item's Product info, Packaging requirements and Shipment, Logistics & Others into it. The item keeps its Product. Grades, TCB inputs and request links are never copied. Nothing is saved until Review & save.
- **Mix products from the Opportunity line**: users with Product edit access open the Mix Product's structure from the item pencil (new version, create a child Product). A saved Mix item whose Product has a newer Active version offers **Update to current mix version**, with a kept/added/removed preview, applied on Review & save.
- **Deleting a Draft Mix item** from its parent row's delete icon now removes the whole Mix family. Children have no delete icon of their own.
- **Dialogs** close with the header ✕ only; duplicate text **Close** buttons were removed. On narrow screens, notifications sit below dialog headers so the ✕ stays reachable.
- **Recipe Sheets**: levels have a Process Type and Loss %; Full view shows the combined Ingredient Loss and an editable Buffer Ratio; pricing recalculates automatically, so there is no Calculate pricing button.
- **Excel Local Update**: Ingredients Master and Ingredient Pricing workbooks are available. All Local Update workbooks no longer suggest hidden field names while typing. The Opportunity workbook is now version `opportunity-5`, so older downloads ask for a fresh workbook.

## Validation

`tests/python/vm_upgrade_160_to_163_contract.py` checks exact ordered embedding, target guards and final verification. It also applies all four migrations twice in a rolled-back transaction on the desktop `test` database and compares data hashes. `tests/python/shipment_duty_contract.py` checks Duty and Payment term; `tests/python/opportunity_mix_refresh_contract.py` checks the Mix version update end to end (rollback-only); `tests/python/opportunity_item_delete_contract.py` checks item and Mix family deletion.

Regenerate with `scripts/Build-VMUpgrade160To163.ps1`; the generator never connects to a database. Checksums come from `deployment/company/New-ReleaseChecksums.ps1`.
