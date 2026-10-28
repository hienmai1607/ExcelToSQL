# VM upgrade through migration 152

## If the VM is already through 151

1. Let users finish saving, back up the application database and stop the API.
2. Select the application database and run [152_tcb_quaternary_loss_assignment.sql](../sql/152_tcb_quaternary_loss_assignment.sql). It only updates the TCB save procedure; it does not change existing prices, loss values or saved transactions.
3. Restart the API and reopen TCB Review. Confirm that a four-layer item can save a Direct price of 0.1, reopen, then save another value.

This fix requires SQL. It is separate from the previous pallet-FX precision hotfix, which only required updated API files. No additional API or frontend changes are needed for migration 152; keep the pallet precision hotfix (642d8b7) or newer deployed.

## If the VM is through 147

Use the [combined upgrade 148-152](../sql/deploy/upgrade_148_to_152_vm.sql). It embeds all five migrations and requires migration 147. Follow the backup, API stop, matching-file deployment and restart instructions in [148-151](vm-upgrade-148-to-151.md), substituting the new combined script. Use SSMS SQLCMD mode or `sqlcmd -b` with the application database selected. The bundle is rerunnable but not atomic; original migration transaction boundaries remain. Earlier committed migrations remain applied after a later failure.

## Cause and fix

The four-layer API/UI includes an item-owned `QuaternaryPackaging` loss row even when the fourth-layer loss is 0%. The SQL save procedure allowed anonymous item-owned packaging rows only for Primary, Secondary, Tertiary and the three local Mix slots. Saving a direct raw price therefore failed with `Loss assignment changed or is invalid` when the Quaternary row was first persisted. The direct price was valid.

Migration 152 adds Quaternary to the same Sequence 1 packaging-loss rule and its legacy aggregate mapping. Bounds, stale/unknown master checks, direct-price snapshot checks, access checks and optimistic concurrency remain intact. Mix parents retain their existing local three-slot mapping; this migration does not add another Mix layer.

## Validation

The exact error was reproduced through the real commercial save API and SQL procedure with a direct price of 0.1 and four packaging-loss rows. Six rollback-only tests cover consecutive save/reopen, legacy fourth-layer aggregates, invalid sequence, invalid loss percentage, unknown master and unnamed processing assignment rejection. Fixtures and rowversions are restored. The combined bundle contract verifies exact sources, guard/verification coverage and two SQL reruns with unchanged business data.

Regenerate using `scripts/Build-VMUpgrade148To152.ps1`. Desktop-only tests: `tests/python/tcb_quaternary_loss_contract.py` and `tests/python/vm_upgrade_148_to_152_contract.py`. Do not run fixture/audit scripts against the VM; use disposable UAT data for the smoke check.

## Four-layer TCB display hotfix

The TCB Packaging table previously hard-coded Primary/Secondary/Tertiary columns, even when the loaded item had four layers. The hidden Quaternary loss row was still submitted on save; three visible columns therefore did not prove that the item had only three configured layers. The table now uses the shared four-layer list and displays Quaternary price and its editable loss percentage. One/two/three-layer items retain their actual column count. The table has sufficient minimum width for four price/ratio pairs without overlapping controls.

Deploy the latest `webapp/dist/` and hard-refresh the browser to load this display fix. No additional SQL or API changes are required beyond migration 152 and the previously published API hotfixes. Migration 152 remains required to save the fourth-layer loss assignment. Regression coverage verifies 1-4 layer layouts on desktop/mobile and saving a Direct price of 0.1 together with Quaternary loss.
