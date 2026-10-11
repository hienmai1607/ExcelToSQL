# VM upgrade: migrations 97-104

Use `sql/deploy/upgrade_097_to_104_vm.sql` for an existing application database already through migration 96. It embeds migrations 97-104 in numeric order and needs no external SQL includes. Do not run the individual files as well.

## Prepare and execute

Have the DBA confirm the current migration level and back up the database. Let users finish saving, stop the API service, and run on a new connection without an open transaction.

If older upgrades are missing, apply the existing bundles in order: 45-85, 86-88, 89-96, then 97-104. Run each older bundle only when its documented prerequisites match the VM. Do not reapply older procedure definitions after a later upgrade.

This is not a fresh database installer. The company fresh-database manifest is not a complete installer for this release.

In SSMS, select the application database and enable **Query > SQLCMD Mode**. Alternatively, from the PythonBridge directory:

```powershell
sqlcmd -S YOUR_SERVER -d YOUR_DATABASE -E -b -i sql/deploy/upgrade_097_to_104_vm.sql
```

Replace the server and database placeholders. Use an authorized deployment account with schema-alter permissions.

The bundle refuses system databases, open transactions, compatibility levels below 130 and missing migration-96 prerequisites. Final checks verify the new objects and updated procedure signatures. Structural checks do not prove that every earlier migration was applied correctly.

Source transaction boundaries are preserved: this upgrade is **not atomic**. Earlier migrations may already be committed if a later batch fails. Stop and investigate; do not restart the API with a partially upgraded schema. Restore the backup when rollback is required.

## Included changes

| Migration | Change |
|---|---|
| 97 | Category Master seeded from existing Product category names |
| 98 | Required exact Container Type and Pallet size validation |
| 99 | Packaging Final component eligibility |
| 100 | Shared conversion output UoM |
| 101 | Applicable response weight and grade-density defaults/history |
| 102 | Revised shipment cost units, interest/payment days and margin basis |
| 103 | Pallet price USD per EA |
| 104 | Administrator workspace roles, page permissions and user assignments |

Existing Users and direct UserAccess grants remain unchanged. No sample accounts, roles, credentials or business records are imported. Saved pricing, costs and historical snapshots are retained. Migration 101 rebuilds a derived computed volume column, not stored historical values.

## Deploy the application

Deploy matching `core/`, `webapp/dist/`, `templates/` and dependency files from the same Git commit. The built UI is included; Node.js is not needed on the VM solely to serve it. Install Python dependencies in the VM virtual environment if necessary.

Preserve VM-local configuration, service identity, database settings and secrets. Do not copy workstation `.env`, backups, dumps, logs or test data.

For shared IIS deployment, keep `AUTH_MODE=trusted_proxy`, authenticated identity/secret forwarding and the API bound to loopback. DNS, a matching TLS certificate and IIS bindings must be configured separately; copying this release does not create them. See [Authentication and deployment](authentication-and-deployment.md).

Restart the single managed API service after successful SQL verification. Hard-refresh the browser and download new local Excel templates. Already-open workbooks are not updated.

## Smoke checks

1. Verify `/health/live`, `/health/ready` and the HTTPS workbench.
2. Check `/api/workbench/session` for a real non-Admin identity through IIS.
3. Confirm No access pages and empty groups are hidden. Display users cannot save and receive read-only .xlsx templates where supported.
4. As Admin, check User role, User master, Market Master and Currency Master. Assign approved roles deliberately; the migration does not grant new access automatically.
5. Open an existing Opportunity and Packaging Request; check stage details, Product Info/Packaging requirements, weight/loading, shipment costs and TCB Analysis.
6. Exercise one approved test save and Excel download in UAT before production release.

Bundle contract tests are read-only artifact checks. They do not execute the upgrade on the VM or validate its IIS configuration.
