# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A presales system for Opportunity → Packaging Request / Recipe Request (NPD) → TCB costing, plus the master data those workflows use. There are three layers:

- **SQL Server** (`sql/`) is authoritative. Constraints, RowVersion concurrency, workflow stage transitions, audit/change logs and CreationKey idempotency live in tables and `dbo.usp_*` procedures.
- **FastAPI bridge** (`core/`, entry `core/main.py`) authenticates the caller, rechecks scopes/page permissions and calls SQL. Modules import each other flat (`--app-dir core`), not as a package.
- **Clients:**
  - The React/TypeScript workbench (`webapp/`) is served at `/workbench/`; it's the primary UI.
  - Excel `.xlsm` workbooks with VBA in the root `.bas` files are the older client. They now mainly serve as downloadable "Local Update" templates.

Domain terms (packaging geometry, NPD recipe, ingredient, seasoning) are defined in `CONTEXT.md`. Use those terms.

## Commands

Local development uses the desktop SQL Server `DESKTOP-5BGMJSC`, database `test`, with Windows auth (defaults in `core/db.py`). `AUTH_MODE` defaults to `local_windows`, which means the identity is the account running the API. `development_header` honours `X-User-Name` and is only for testing.

```powershell
# API (build webapp first so /workbench/ mounts webapp/dist)
python -m uvicorn main:app --app-dir core --host 127.0.0.1 --port 8000

# Webapp (in webapp/)
npm.cmd ci
npm.cmd run build          # tsc --noEmit + vite build -> webapp/dist (dist is committed)
npm.cmd run dev            # http://127.0.0.1:5173/workbench/ against API on :8000
npx.cmd playwright test tests/npd.spec.ts            # one spec
npx.cmd playwright test tests/npd.spec.ts -g "Recipe Sheets"   # one test
```

Playwright starts its own Vite dev server and mocks `/api/**` with `page.route`, so no API or DB is needed.

Python tests are standalone `unittest` scripts with no pytest config:

```powershell
python tests/python/npd_master_excel_contract.py
python tests/python/npd_master_excel_contract.py Contracts.test_workbook_layout_required_and_hidden
```

- `*_contract.py` tests are mostly in-process.
- `*_sql_contract.py` and `*_desktop_contract.py` run against the desktop `test` DB using rollback-only fixtures.
- Some existing contracts fail on a clean checkout. Compare against a `git stash` baseline before attributing failures to a change.

Apply SQL with `sqlcmd -S DESKTOP-5BGMJSC -E -C -d test -b -i <file>`. SQL contracts live in `tests/sql/`, and runners such as `tests/run_admin_master_tests.ps1` wrap them.

## Architecture notes that span files

- **Authorization is layered.**
  - `auth.get_access_context` resolves the user, their scopes and the page permissions from `core/workspace_access.py`. That file maps scopes to page `none`/`display`/`edit` defaults; roles can extend them and Admin gets everything.
  - Page permissions supplement SQL checks and never replace them; procedures recheck roles, stages and ownership.
  - NPD endpoints use `npd_api.access(ctx, page, edit)`.
- **Writes carry the original `RowVersion`.** A stale version must fail with a conflict, not overwrite. Creates that can be retried use a `CreationKey`. If a save's outcome is unknown, the UI and Excel block resubmission until the user refreshes.
- **Master read models:**
  - Packaging/raw masters use `core/master_models.py` (allow-listed `COLUMNS`, `FILTERS`, `MASTER_REQUIRED_COLUMNS`) with `packaging_master_api.py`.
  - Smaller "shared masters" (ingredients, ports, categories, loss processes…) use `core/shared_master_views.py` `LABELS` with `webapp/src/shared-master-view.tsx`.
  - Sort columns go through these allow-lists before being placed into SQL text. Everything else is parameterized.
- **Excel Local Update workbooks are generated at runtime** from base templates in `templates/` by editing the OOXML zip. No Excel is needed on the server.
  - Masters: `packaging_master_excel_api.py`, which also dispatches ingredients to `npd_master_excel.py`. It uses `templates/Packaging_Master_Local_Update.xlsm` with VBA `modPackagingMasterLocal.bas`. Product, Opportunity and Packaging Request have their own `*_excel_api.py`, template and `mod*Local.bas`.
  - Sheet layout: `Master` (row 1 headers, row 2 hidden field keys, data from row 3), `Controls`, and hidden `_Config`.
  - Hidden `_ID`/`_RowVersion`/`_Original` columns let VBA send only changed fields.
  - Dropdowns come from `core/excel_dropdowns.py`.
  - `core/excel_template_version.py` versions each workbook family. Bump the family when the save contract changes; old workbooks are then rejected.
  - Every template imports `modAutoCompleteGuard.bas` and has `ThisWorkbook` events that switch Excel AutoComplete off while it is active, so the hidden key row isn't suggested (`docs/excel-autocomplete-guard.md`). New template builders must do the same; verify with `scripts/test_autocomplete_guard.ps1`.
  - After editing a `.bas`, rebuild its template with Excel closed, e.g. `powershell -File scripts/build_packaging_master_local_template.ps1`. These scripts back up the old file and need Excel COM with VBA project access. `scripts/test_*_local_template.ps1 -WorkbookPath <download>` runs VBA checks inside Excel.
- **Workflows.**
  - Packaging and Recipe responses go: team submission → manager approval → **Awaiting Sales** → Sales (original requester) Accept/Return.
  - Only Sales acceptance publishes to the Opportunity: a packaging family is published atomically, and an approved Recipe Sheet's seasoning is published to TCB.
  - Each Opportunity item can have only one open request of each kind.
- **TCB** (`tcb_*.py`, `webapp/src/tcb-*.ts(x)`) costs an item from raw-grade prices, process loss, recipe components (Salt/Oil/Seasoning), packaging, pallet, shipment and FX. Each save also captures a version snapshot.

## Change conventions

- **SQL migrations** are numbered sequentially in `sql/` (latest: `163_*`). They must be rerunnable (guarded `IF COL_LENGTH…`/`OBJECT_ID` checks, `SET XACT_ABORT ON`) and start by checking that their prerequisite migration has been applied.
- **VM releases** bundle migration ranges into `sql/deploy/upgrade_<from>_to_<to>_vm.sql`, built by `scripts/Build-VMUpgrade*.ps1`, with a matching `docs/vm-upgrade-*.md`. Ship API and `webapp/dist` from the same commit. VM deployment is done by the user, not as part of a change.
- **Each feature gets a doc in `docs/`** covering behaviour, the migration (or "no SQL migration required"), deployment steps and verification commands. Link it from the related doc or the README.
- **Restart and refresh.** After API changes, restart uvicorn (the running process doesn't reload). After UI changes, run `npm.cmd run build`; users then hard-refresh.
- **Untracked folders.** `backups/`, `logs/`, `artifacts/` and `test-results/` are local outputs and are not tracked.
