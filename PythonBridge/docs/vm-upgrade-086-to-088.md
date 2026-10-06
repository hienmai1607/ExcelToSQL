# VM upgrade: packaging Mix Products and summaries

For a database already upgraded through migration 85, copy and run only
`sql/deploy/upgrade_086_to_088_vm.sql`. It contains migrations 86, 87 and 88
in order, without local `USE [test]` commands or external include dependencies.

The original individual migration files remain for development and tests.
Use the combined file OR the individual scripts, not both as a deployment plan.
The older `upgrade_045_to_085_vm.sql` is unchanged; this bundle does not replace
missing migrations before 86. A fresh database needs the separate install path.

## What to copy to the VM

Copy these matching files from the same Git commit:

- `core/`: all application backend files, including `mix_efficiency.py` and
  `mix_same_config.py`. Copy source files, not local Python cache directories.
- `webapp/dist/`: the entire rebuilt directory, including `index.html` and
  its matching hashed assets. No Node build is needed on the VM.
- `sql/deploy/upgrade_086_to_088_vm.sql`: the one new SQL deployment file.

Do not overwrite the VM's environment variables, `.env`, virtual environment,
credentials, `deployment/private/`, uploaded attachments or logs.
No workbook/VBA files or Python dependency manifests changed in this release.

## Deployment order

1. Back up the application database and existing API/webapp deployment.
2. Stop the API/service, so old and new versions cannot write concurrently.
3. Open a new SQL connection to the intended application database.
4. In SSMS enable **Query > SQLCMD Mode**, select that database, and execute the
   combined file. Or use Windows-integrated authentication with:

   ```powershell
   sqlcmd -S YOUR_SERVER -d YOUR_DATABASE -E -b -i upgrade_086_to_088_vm.sql
   ```

5. Confirm the final success message. SQLCMD stops on the first error; earlier
   migrations may already have committed. Do not start the new API on failure:
   investigate and use the backup if a rollback is required.
6. Deploy the matching `core/` and `webapp/dist/` directories.
7. Restart the API and hard-refresh browser clients.

These migrations preserve existing request, pricing and master history.
Existing Same config switches start OFF. No history clearing is included.
Historical requests without a captured Mix composition are not reconstructed
from today's Product Master.

## Smoke checks

- Open an Opportunity Mix Product: child logistics inherit the parent;
  Mix parent packaging choices use Secondary/Tertiary master types.
- Check the current linked PCR ID and the Packaging Summary tree, including
  two-decimal customer-currency prices with USD equivalents when applicable.
- Enter each child's density; check the parent Total Used volume and efficiency.
- Enable Same config on an editable Mix PCR: first-child packaging copies to
  other children, but their densities and product weights remain independent.
- Change confirmed layer counts and return: unsaved layer inputs are retained.
- Save/reopen Same config; hover/focus its info icon for help.
