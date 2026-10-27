# VM upgrade: migrations 148-151

Use [the combined SQL script](../sql/deploy/upgrade_148_to_151_vm.sql) on an existing application database already through migration 147. All four migrations are embedded in order. The script is rerunnable and does not rewrite business records or saved pricing snapshots.

## Deployment

1. Confirm the baseline. If the VM is through 141, first apply [142-147](vm-upgrade-142-to-147.md). Earlier baselines must follow the preceding upgrade instructions linked there. Do not use the fresh-database installer on an existing VM.
2. Let users finish saving, back up the database, confirm the restore path and stop the managed API service.
3. On a new SSMS connection, select the application database, enable **Query > SQLCMD Mode**, then run `sql/deploy/upgrade_148_to_151_vm.sql`. Alternatively:

   ```powershell
   sqlcmd -S YOUR_SERVER -d YOUR_DATABASE -E -b -i sql/deploy/upgrade_148_to_151_vm.sql
   ```

4. Stop on any error. This bundle is **not atomic**: each migration keeps its own transaction. Earlier migrations may have committed. Resolve the error and rerun, or restore the backup before rolling back application files. Do not start a partially upgraded application.
5. After **Upgrade 148-151 verified**, deploy `core/`, `webapp/dist/`, templates, dependency files and other release files from the same Git commit. The compiled frontend is included; Node.js is not needed on the VM. Verify `deployment/company/release-files.sha256` after transfer.
6. Preserve VM-local `.env`, secrets, uploads, backups, service configuration and identity. Retain the trusted HTTPS proxy, loopback API, `AUTH_MODE=trusted_proxy` and `LOCAL_AI_ENABLED=0`.
7. Restart the API and hard-refresh browsers with **Ctrl+F5**.

## Included changes

| Migration | Change |
| --- | --- |
| 148 | Additional Incoterms and warehouse-cost breakdown validation |
| 149 | Publish only approved packaging responses to linked Opportunity items; retain the last approved result while newer work is pending |
| 150 | Accept g or kg tare per material Base UoM, retaining legacy tare values and snapshots |
| 151 | Offer active pallet materials before pricing exists; footprint availability comes from material dimensions |

Application changes include compact warehouse-cost calculation with a read-only total; visible shipment fields for every Incoterm; Packaging Price shortcut access; Pallet and Container Add/Edit shortcuts; live Mix gross weights; shared type-choice refresh during response validation; Add/Edit Pallet Pricing inside its calculator; and automatic RM Ratio = 100 - salt percentage - oil percentage for each recipe row.

## Smoke checks

- Verify `/health/live`, `/health/ready` and the workbench through the VM proxy with Admin and an appropriate Packaging role.
- Confirm unapproved responses do not overwrite Opportunity packaging fields. A newer pending response must retain the previous approved result; an item without approved packaging remains blank.
- Choose a newly maintained active pallet without pricing, verify capacity suggestions, then add its price inside the calculator. Missing prices remain blank until maintained; blocked materials remain unavailable.
- Save/reopen a material using g/EA or g/m2 and verify pricing tare and gross weights. Legacy tare bases must retain their meaning.
- Open Packaging Price through its shortcut; normal master permissions and save validation must still apply.
- Edit a Packaging Type inline and save the response without reopening it.
- Verify Mix parent and copied-child gross weights before saving.
- Check warehouse-cost breakdown, total, custom currency and save/reopen. Set salt to 3%, oil to 0%, and verify RM Ratio becomes 97% and saves correctly.
- Use disposable UAT records and remove them afterward. Do not run desktop-only fixture/audit scripts on the VM.

## Regeneration and checks

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Build-VMUpgrade148To151.ps1
python tests/python/vm_upgrade_148_to_151_contract.py
```

The contract verifies exact source embedding, ordering, baseline guards, final verification and rollback-only SQL reruns with business-row preservation. Desktop checks also cover warehouse costs, approved-only publication, tare mass units, unpriced pallet selection and costing replicas.

## Known test limitations

The broad browser suite still includes four legacy `opportunity-mix.spec.ts` fixtures that expect removed Mix layer labels or configurations exceeding four combined child/parent layers. The fixture file and the relevant requirements component are unchanged from the preceding published release. Separately, eight legacy `tcb.spec.ts` expectations fail on both the previous behavior and the new automatic RM-ratio behavior (baseline replay verified); these cover retired labels and process semantics. These failures are not counted as passing release checks. Current four-layer Mix behavior is covered by the response/packing tests and live replica audits.
