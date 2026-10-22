# VM upgrade: migrations 138-141

Use [the combined SQL script](../sql/deploy/upgrade_138_to_141_vm.sql) on an existing
application database already through migration 137. It embeds migrations 138-141
in order, with no external includes. It can also be rerun when 138 or the later
migrations were already applied. Do not use the fresh-database installer.

## VM steps

1. Confirm the baseline. If the VM is only through 116, first apply the
   [117-137 bundle](vm-upgrade-117-to-137.md). Older baselines must use the earlier
   bundles linked there.
2. Back up the database and verify the restore path. Let users finish saving and
   stop the managed API service.
3. Select the intended database in SSMS on a new connection and enable
   **Query > SQLCMD Mode**, then run the combined script. Alternatively:

   ```powershell
   sqlcmd -S YOUR_SERVER -d YOUR_DATABASE -E -b -i sql/deploy/upgrade_138_to_141_vm.sql
   ```

4. Stop on any error. This bundle is **not atomic**: individual migration
   transaction boundaries are preserved. Earlier migrations may have committed.
   Restore the backup if rollback is required; do not start a partially upgraded
   application.
5. Deploy `core/`, `webapp/dist/`, dependency files and other release files from
   the same Git commit. The compiled UI is included; Node.js is not needed to
   serve it. Verify `deployment/company/release-files.sha256` after transfer.
6. Preserve VM-local `.env`, service configuration, credentials, uploads and
   service identity. Keep the authenticated HTTPS proxy, loopback-only API,
   `AUTH_MODE=trusted_proxy` and `LOCAL_AI_ENABLED=0`.
7. Restart the managed API only after SQL verification succeeds. Hard-refresh
   the browser and perform the smoke checks below.

## Changes and data preservation

| Migration | Change |
| --- | --- |
| 138 | Customer-currency shipment/design inputs |
| 139 | Shared setting for Process Types |
| 140 | Child-owned Others Info; shared shipment/logistics stay on the Mix parent |
| 141 | Grade/Process Type loss defaults, All grades defaults and independent child/parent processing |

Existing master percentages, captured grade trees, TCB JSON and historical
records are retained. Shared defaults to false for existing types. Existing
parent Others amounts are not redistributed automatically: explicitly review
the children's packing, design, fixed costs, interest and margin before quoting.
The All grades Packing default is maintained in Loss Process Master.

Matching application files include the audited quantity-save, nested Mix gross
weight and missing-composition efficiency fixes, plus Add/Edit Master parity.
Saved load plans remain immutable snapshots: explicitly recalculate affected Mix
plans; this upgrade does not silently rewrite approved historical loading data.

## Smoke checks

- Check `/health/live`, `/health/ready` and the workbench through the VM proxy;
  test a non-Admin role as well as Admin.
- Edit a Customer from its master list and Opportunity shortcut; confirm the same
  editor and save validation, without submitting the parent Opportunity form.
- Open Process Types / Loss Process Master. Check Shared, distinct Grade/type
  defaults and an All grades Packing default.
- In a disposable UAT Opportunity, enable both child and parent Process. Confirm
  aligned inherited loss codes, manual formulas, Level 1 recipe inputs, and
  before/after-loss RM prices.
- Save/reopen a quantity read from SQL such as `50000.0000` without conversion
  errors. Check USD exchange rate is locked at 1.
- Check Mix child-only Others fields, quantity-based parent cost allocation,
  child packaging counts, container net/gross weights and TCB Analysis.
- Verify the AI launcher remains disabled. Do not run the desktop-only replica
  audit against the VM; use disposable UAT records and remove them afterward.

## Verification

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Build-VMUpgrade138To141.ps1
python -m unittest discover -s tests/python -p vm_upgrade_138_to_141_contract.py -v
```

The artifact tests check exact source embedding and safety guards. The SQL test
is restricted to desktop `test`, runs migrations twice inside a rollback-only
transaction and checks existing business IDs/rowversions are retained. It does
not execute against the VM or prove a fresh 137-baseline upgrade there. Test the
bundle on a restored VM database first.

See the [Opportunity audit report](opportunity-replica-audit-2026-10-23.md) for
309 live-schema workflow checks, independent costing comparisons, cleanup and
the explicitly documented legacy test-suite limitations.
