# VM upgrade: migrations 89-96

Use `sql/deploy/upgrade_089_to_096_vm.sql` for an existing application database already through migration 88. It contains migrations 89-96 in order. Do not run the individual files as well.

Back up the database, stop the API, and run on a new connection. In SSMS, select the application database and enable Query > SQLCMD Mode. Alternatively:

```powershell
sqlcmd -S YOUR_SERVER -d YOUR_DATABASE -E -b -i sql/deploy/upgrade_089_to_096_vm.sql
```

This is an incremental upgrade, not a fresh database installer. If the VM is only through 85, first run `sql/deploy/upgrade_086_to_088_vm.sql`. Do not reapply older procedure definitions after this upgrade.

The bundle preserves source transaction boundaries and is not atomic: earlier changes may remain committed if a later migration fails. Stop on errors and investigate before restarting. Migration 94 removes the obsolete Product Loss snapshot trigger and Product Loss write procedure; historical columns/JSON remain retained.

Deploy matching `core/`, `webapp/dist/`, and `templates/Opportunity_Local_Update.xlsm` together. Keep VM-local configuration/Windows identity; do not copy development credentials. Restart the API, hard-refresh the browser, and download a new Opportunity workbook. Existing open workbooks are not updated automatically.

Check Ports of Entry and Loss Process Master, open TCB Review for a parent/standalone item, verify Analysis and calculated grid columns, and confirm Excel child logistics cells identify the parent row to edit.
