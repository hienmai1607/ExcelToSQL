# VM upgrade: migrations 105-116

Use [the combined SQL script](../sql/deploy/upgrade_105_to_116_vm.sql) for an existing application database already through migration 104. It embeds migrations 105-116 in numeric order; no external includes are needed. Run the bundle OR its individual migrations, not both.

## Upgrade procedure

1. Confirm the VM database is through migration 104. Older databases must follow the existing bundles in order: 45-85, 86-88, 89-96, then [97-104](vm-upgrade-097-to-104.md). Do not apply older procedure definitions after this release.
2. Back up the application database and confirm a restore path. Let users finish saving and stop the managed API service.
3. In SSMS select the intended application database and enable **Query > SQLCMD Mode**. Use a new connection without an open transaction. Alternatively, from the PythonBridge directory:

   ```powershell
   sqlcmd -S YOUR_SERVER -d YOUR_DATABASE -E -b -i sql/deploy/upgrade_105_to_116_vm.sql
   ```

4. Wait for the final verification messages. The script refuses system databases, open transactions, compatibility levels below 130, missing baseline objects, or missing EA/MM units and USD currency.
5. Deploy matching `core/`, `webapp/dist/`, templates and dependency files from the same Git commit. The rebuilt UI is included; Node.js is not required just to serve it on the VM.
6. Preserve VM-local configuration, service identity, secrets, attachments and database connection settings. Do not copy workstation `.env`, dumps, logs or test data. Shared deployments must retain `AUTH_MODE=trusted_proxy`, authenticated HTTPS proxy forwarding and a loopback-only API listener.
7. Restart the managed API only after SQL verification succeeds. Hard-refresh the browser. Download fresh Excel local-update templates where applicable.

**This upgrade is not atomic.** Each source migration keeps its transaction boundaries; some earlier migrations may be committed if a later batch fails. Stop and investigate before restarting. Restore the backup if rollback is required. Do not run the fresh-database installer against an existing VM database.

## Included changes

| Migration | Change |
|---|---|
| 105 | Packaging PIC ownership and workflow permissions |
| 106 | Copy Dim. fields and material pricing dimensions |
| 107 | Restrict Copy Dim. to root Single types |
| 108 | Container Type Master and immutable load plans |
| 109 | Pallet packaging order |
| 110 | Additive migration of legacy pallets to materials/pricing |
| 111 | Selected response plan and selection audit history |
| 112 | Material tare weight and basis |
| 113 | Admin override for unlocked responses |
| 114 | Pallet footprint choices from maintained material dimensions |
| 115 | Immutable pallet/accessory pricing snapshots |
| 116 | Independent current plans per container type |

Legacy pallets, users, direct access grants and historical response/plan records are retained. Migration 110 creates linked materials and existing non-null pallet prices; it does not invent actual pallet height or tare. Verify those values and vendor pricing before using a migrated pallet.

This bundle does not seed Container Type Master. Admin must maintain or verify active container types, internal dimensions, clearances, door sizes and maximum payloads. Do not treat empty catalogues or unknown tare as zero.

## Application fixes included in this release

Non-Admin pallet pricing follows Packaging Request page permissions and existing PIC/version checks. New item loading calculations use saved response weights and packing settings, not client overrides. Save response changes before opening 3D preview.

Physical response changes through Excel or API clear obsolete active plans and container mappings, including affected parent plans after child edits. Immutable history is kept; note-only changes preserve selections.

## VM smoke checks

- Check `/health/live`, `/health/ready`, the HTTPS workbench and a real non-Admin session through the proxy.
- As an assigned Packaging PIC, open pallet pricing, preview and save an approved UAT example; display-only users must not save.
- Verify saved carton gross, cartons/layer, loaded pallet dimensions and pallet/accessory tare match 3D results.
- Confirm a container preview, then Review & save the response; check separate container setups and net/gross totals.
- In UAT, change cartons/layer through Excel and verify obsolete selected plans are cleared; independently changing a child must invalidate only its related parent.
- Check parent-family assignment, submit/approve permissions, Packaging Summary gross weights and TCB Palletization USD cost.

Local artifact and rollback tests do not deploy to the VM or validate its IIS configuration. The existing company fresh-database manifest is not a complete fresh installer for this release.
