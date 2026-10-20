# VM upgrade: migrations 117-137

Use [the combined SQL script](../sql/deploy/upgrade_117_to_137_vm.sql) for an existing application database already through migration 116. It embeds all 21 migrations in numeric order; there are no external includes. Run the bundle OR the individual migrations, not both.

## Move to the VM

1. Confirm the database baseline. If it is through migration 104, first apply [105-116](vm-upgrade-105-to-116.md). Older baselines must follow the earlier bundles linked there. This is not a fresh database installer; do not use the company fresh installer on an existing database.
2. Back up the database and verify the restore path. Let users finish saving and stop the managed API service.
3. In SSMS, select the intended application database, open a fresh connection, and enable Query > SQLCMD Mode. Alternatively run:

   ~~~powershell
   sqlcmd -S YOUR_SERVER -d YOUR_DATABASE -E -b -i sql/deploy/upgrade_117_to_137_vm.sql
   ~~~

4. Stop on any error. This upgrade is not atomic: each migration retains its transaction boundaries, so earlier batches may already have committed. Restore the backup if rollback is required. Do not restart against a partially upgraded database.
5. Deploy core/, webapp/dist/, templates/ and dependency files from the same Git commit. Install the Python dependencies into the VM's service environment as required by the existing deployment runbook. The rebuilt UI is included; Node.js is not needed just to serve it.
6. Preserve VM-local .env/service settings, credentials, uploads, database connection configuration, and service identity. Do not copy workstation secrets, dumps, logs or test output. Keep AUTH_MODE=trusted_proxy, an authenticated HTTPS proxy, and a loopback-only API listener.
7. Keep LOCAL_AI_ENABLED=0. The AI launcher is intentionally disabled in this release, including when an AI backend is reachable. Normal application use requires no Ollama installation. See [AI rollout pause](local-ai-integration.md).
8. Restart the managed API only after SQL verification succeeds. Hard-refresh the browser and download updated Excel local-update templates.

## Changes and data review

| Migrations | Changes |
|---|---|
| 117-119 | Customer-currency clearance per container, material-owned dimensions, pallet material selection |
| 120-123 | Business deletion audit, grade-density maintenance, private AI history/feedback schema (AI remains disabled) |
| 124-129 | Packaging/Mix flags, globally unique type names, UoM categories, optional pallets, multiple parents, length-unit validation |
| 130-133 | Explicit Product weight refresh, raw origin, Single Copy Dim., safe price overlap resolution |
| 134-137 | Final raw grades, editable Opportunity net weight, per-item TCB versions, Process-parent recipes |

Important migration behavior:

- 118 copies unambiguous price dimensions to Material. Review MaterialDimensionsNeedsReview flags and complete missing/conflicting measurements; do not treat unknown geometry as zero.
- 125 qualifies duplicate Packaging Type display names by parent/order while retaining IDs and references. Review those names. Unresolved collisions stop migration.
- 134 marks existing leaf grades Final. Materials assigned to parent grades must be resolved before migration; the script deliberately stops instead of guessing.
- 136 captures current Opportunity item settings as the first active TCB version and retains alternatives/history going forward. It does not invent old historical approaches.
- Existing historical response snapshots and document history are retained. Review master changes in a restored/UAT database before production cutover.

## Smoke checks

- Check /health/live, /health/ready, the HTTPS workbench and a non-Admin session through the proxy.
- Confirm AI assistant is visible but disabled, with no AI requests.
- Open an Opportunity, edit item net weight, save, reopen and check the captured weight. Test explicit Product-weight refresh independently.
- Check Final grades, direct root-to-material links, Process parent recipes, unchanged grade-price retention and live totals.
- Create/copy/save a TCB alternative, compare it, then explicitly activate it. Verify only one version is active for each item.
- Check Packaging Material dimensions, Single Copy Dim., live pallet totals, USD exchange rate = 1, and a UAT price-overlap bypass example.
- Download the updated Excel templates and verify required flags/fields before bulk updates.

## Artifact verification

Regenerate the mechanical bundle after editing any included migration:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Build-VMUpgrade117To137.ps1
python -m unittest discover -s tests/python -p vm_latest_upgrade_bundle_contract.py -v
~~~

Artifact checks verify exact source embedding and safety guards; they do not execute SQL or deploy to the VM. This release has not been run against your VM database. Test it on a restored copy first.
