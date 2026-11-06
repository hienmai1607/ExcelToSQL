# VM release — 6 November 2026

This release adds the NPD workspace, Recipe Requests/Sheets, ingredient pricing,
Recipe Components and their TCB integration. Use the application and SQL from the
same commit. SharePoint storage has only been discussed; attachments still use
the existing local storage provider.

## Existing VM database upgrade

The combined [upgrade_153_to_157_vm.sql](../sql/deploy/upgrade_153_to_157_vm.sql)
requires the existing application database through **152**. It includes:

| Migration | Purpose |
| --- | --- |
| 153 | Pallet special comments in captured packaging requirements |
| 154 | Ingredients/pricing, Recipe Requests/Sheets/audit, NPD roles and access defaults |
| 155 | Recipe Components, process-component relationships, recipe confirmation/requirements and linked-request grade locks |
| 156 | Sheet VND/USD exchange rate and high-precision calculated loss/buffer |
| 157 | Ingredient grade/type/nature metadata |

If migration 153 is already installed, run the same bundle: it checks existing
objects and can be rerun. Do not use the fresh-database installer on an existing
VM database. Older databases must first be upgraded through 152.

1. Let users finish saving. Back up the application database and retain the
   currently deployed `core/` and `webapp/dist/` for rollback.
2. Stop the API service and **all workers**.
3. Select the existing application database. Run the combined SQL in **SSMS
   SQLCMD mode**, or use `sqlcmd -b` with an explicit server/database. The script
   contains no `USE`; do not run it against a system database.
4. Confirm the final message: `Upgrade 153-157 verified. Deploy matching application files before restarting.`
5. Copy the complete updated **`core/`** and **`webapp/dist/`** folders, including
   their newly added files. Remove obsolete compiled assets by replacing the
   old `dist/` with the complete matching build. Preserve the VM environment,
   credentials, authentication/service configuration and attachment storage.
6. Restart the API service/all workers, then hard-refresh browsers with Ctrl+F5.
7. An Administrator assigns the appropriate NPD Member / NPD Manager roles and
   checks page permissions. The upgrade creates roles; it does not assign users.
8. Maintain **Process Types → Recipe Components** for the existing Oil, Salt and
   Seasoning processes before users reopen affected TCB recipes. The upgrade
   seeds Salt/Oil/Seasoning components and the standard Seasoning mapping only;
   it does not infer company-specific process mappings from names.

Step 8 matters because active TCB recipes resolve the current process-component
configuration. Existing costing JSON is preserved by migration, but opening or
recalculating an active recipe can remove components absent from its mappings.
See the [snapshot audit](transaction-snapshot-audit-2026-11-06.md) for this and
other existing live-reference behavior; this release does not fix those audit
findings.

The bundle is **not atomic**: each migration retains its original transaction
boundaries, so earlier migrations may remain committed if a later one fails.
SQLCMD stops on error. Resolve the error and rerun the bundle before restarting
the updated API. Restoring an older release after business use requires a
coordinated database/application rollback; copying older API files alone is not
the rollback procedure.

## Data changes and preservation

- Seeds NPD roles, missing page-permission defaults, Salt/Oil/Seasoning component
  definitions and the standard Seasoning process/mapping.
- Adds columns, tables, constraints, indexes and linked Recipe Request guards.
- Backfills missing confirmation/requirement metadata on existing linked
  recipes. Existing approved calculations and linked prices remain stored.
- Does not copy desktop Opportunities, requests, recipe cases, test users,
  ingredient pricing or QA master records to the VM.
- Reapplying 155 no longer rewrites already-closed request links merely to set
  their existing `IsLinked=0` value again.

Use `scripts/Build-VMUpgrade153To157.ps1` to regenerate the exact embedded sources.
`deployment/company/release-files.sha256` records the release hashes.

## Included application behavior

- Ingredients Master and effective-dated quantity-tier pricing; direct VND/USD
  price entry with conversion and vendor selection; ranked quote selection.
- Opportunity-owned Recipe requirements and inline Recipe Request creation.
- Recipe Request lists and item lists with layouts, filters, sorting, paging,
  compact assignment controls, separate PIC/approver and revision history.
- Scoped recipes can retain only the applicable Level 1 grades; required recipe
  MOQ follows their captured product share. Ingredient tiers use buffered quantity.
- Recipe calculations include weight/value loss, buffered quantities, FG and
  seasoning totals. Manual fixed-grade prices stay separate from TCB RM prices.
- Submission locks PIC, managers can return or modify-and-approve, and only an
  approved Price Ready/Final revision publishes to the Opportunity. New working
  revisions leave the prior approved link unchanged.
- TCB dynamically displays mapped Recipe Components, applies scoped approved
  seasoning defaults, highlights copied fields and retains manual overrides.
- Recipe milestones, request/sheet links and clearer TCB table layout.

## Verification and VM smoke checks

Desktop release checks passed: the production build, 103 browser/model checks
(including five read-only live checks), 160 focused backend checks and four SQL
bundle contracts. The
SQL check executes all five migrations twice inside an outer transaction and
rolls back, comparing existing business records including NPD, pricing and roles.
This verifies reruns on the current desktop schema, not the VM's actual state.

After deployment, use a disposable VM UAT item to confirm:

1. Ingredients, Ingredient Pricing, Recipe Components, Recipe Requests and Recipe
   Sheets load for authorized roles.
2. Create a Recipe Request from Opportunity, assign PIC, save a sheet using both
   an applicable master quote and a direct price; verify ratios, KG and buffer.
3. Submit, return/revise, submit again, and manager approve. Draft/Pending/Returned
   revisions must not replace the approved Opportunity result.
4. Select configured process types in TCB. Confirm component columns, approved
   seasoning grade scope/defaults, manual overrides and save/reopen.
5. Check the existing Packaging Request workflow and a four-layer/Mix item.

Do not run desktop fixture scripts or the retained-case generator on the VM.
