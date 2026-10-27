# VM upgrade: migrations 142-147

Use [the combined SQL script](../sql/deploy/upgrade_142_to_147_vm.sql) on the existing application database already through migration 141. It embeds all six migrations, in order, without external includes. It is also rerunnable when some or all of 142-147 are already applied. Do not use the fresh-database installer for an existing VM.

## VM steps

1. Confirm the baseline. If the VM is through 137, first apply [138-141](vm-upgrade-138-to-141.md). If it is only through 116, first apply [117-137](vm-upgrade-117-to-137.md), then 138-141.
2. Let users finish saving. Back up the SQL database, confirm the restore path, and stop the managed API service.
3. Select the intended application database in SSMS on a **new connection**, enable **Query > SQLCMD Mode**, and run `sql/deploy/upgrade_142_to_147_vm.sql`. Alternatively:

   ```powershell
   sqlcmd -S YOUR_SERVER -d YOUR_DATABASE -E -b -i sql/deploy/upgrade_142_to_147_vm.sql
   ```

4. Stop on any error. The combined script is **not atomic**: original migration transaction boundaries are preserved. Some earlier migrations may already have committed. Restore the backup if rollback is necessary; do not start a partially upgraded application. Existing Mix families exceeding four total layers must be resolved explicitly; this upgrade does not truncate them.
5. Deploy `core/`, `webapp/dist/`, dependency files, templates and other release files from the **same Git commit**. The compiled frontend is included; Node.js is not required on the VM. Verify `deployment/company/release-files.sha256` after transfer.
6. Preserve VM-local `.env`, credentials, service configuration, uploads, backups and service identity. Keep the trusted HTTPS proxy, loopback-only API, `AUTH_MODE=trusted_proxy`, and `LOCAL_AI_ENABLED=0`.
7. After the final **Upgrade 142-147 verified** message, restart the managed API and hard-refresh browsers with Ctrl+F5.

## Changes

| Migration | Change |
| --- | --- |
| 142 | Pallet material maximum gross payload; initialize the two approved legacy pallet defaults to 1,200 kg only when missing |
| 143 | Four cumulative packaging layers, including Quaternary; archive and retire old Mix memberships; retain historical quantities/prices/snapshots |
| 144 | Section-by-section packaging reference copies and grouped manager review/edit workflow |
| 145 | Optional shipping D2 where unused; consistent Copy Dim. validation |
| 146 | Persist per-container Proposal checkboxes as strict JSON booleans |
| 147 | Keep the requested container type (or at least one matching family/size option) included in Proposal |

Application changes include Add/Edit Master parity, RM-only process-loss calculation/display, four-layer and exact-divisor Mix validation, payload-limited pallet suggestions, USD pallet costing, independent container proposals and manual counts, and the complete-load 3D preview. Floor mode has no pallet fields. The detailed back third and grouped remainder account for the complete load; they do not change carton capacity or costing.

## Smoke checks

- Check `/health/live`, `/health/ready`, and the workbench through the VM proxy, with Admin and an appropriate non-Admin Packaging role.
- Verify Primary/Secondary/Tertiary/Quaternary options and cumulative parent layers. Mix children must leave at least one parent layer; active child packing factors must exactly divide captured parent quantities.
- Open an existing saved response and confirm its captured prices/configuration remain available. Test Copy reference using disposable UAT data, not a live approved quote.
- Change the pallet or maximum height; confirm fresh Cartons/layer and Layers/pallet suggestions and gross-weight/payload validation. Manual overrides remain available.
- In the 3D view, check all five active container alternatives, the mandatory requested Proposal checkbox, independent manual carton counts, save/reload, and only checked options shared with Opportunity.
- Confirm Floor mode has no Palletization panel or Pallets column. For large loads, verify detailed plus grouped counts equal the complete carton total.
- Check pallet USD conversion and TCB Review. Manager confirmation should complete the whole grouped family, and approved records should remain read-only.
- Keep AI disabled. Do not run the desktop-only replica or SQL-rerun audits on the VM. Use disposable UAT records for VM checks and clean them up afterward.

## Verification and regeneration

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Build-VMUpgrade142To147.ps1
python -m unittest discover -s tests/python -p vm_upgrade_142_to_147_contract.py -v
```

The SQL test is desktop-test-only and rolls back its outer transaction. It reruns the migration sources twice and compares complete business rows, including rowversions, captured pricing, plans and archives. The artifact checks verify source embedding, ordering, baseline guards and final verification. The only deletion is the explicitly approved retirement of archived legacy Mix memberships.
