# Optional Shipping D2 and Copy Dim. selection (26 October 2026)

Desktop test has migration 145 applied after 144. Restart the API and hard-refresh
the browser before testing the matching rebuilt application.

- Shipping dimensions require D1 and D3 (Height) with active length units.
  D2 may be blank together with its unit when no formula references D2.
- Diameter + Height definitions can use formulas based on D1 and D3.
  The system does not invent a width or change the user's formulas.
- Copy Dim. from the exact same definition copies by D1/D2/D3 slot identity.
  Legacy duplicate labels no longer make that identity mapping ambiguous.
  Across different definitions, unique name matching and unit conversions remain
  mandatory; stale definitions and missing positive measurements still block.
- The reported Bucket material PKG-0000000793 had Dia in both D1 and D2.
  Its existing measurements are retained; no original master data was repaired
  or silently rewritten. Its Primary preview now succeeds at 20,000 VND/EA.
- If you clear an existing D2, re-save the related material with the refreshed
  definition version and a blank Material D2. Existing snapshots stay unchanged.
- The subsequent pallet-preview refinement supports explicit Diameter + Height
  as a square shipping envelope. Arbitrary missing widths are never inferred;
  see packaging-calculator-pallet-refinements.md for the matching API update.
- The existing Bucket occupied m3 formula divides by 1,000,000 despite mm
  inputs. For a diameter-squared bounding volume, use
  (D1*D1*D3)/1000000000 to output m3. The existing formula was not changed:
  formula entry remains under user control.

## Deployment

Back up the database and stop the API. A VM already through 144 can run
sql/145_optional_shipping_d2.sql. A VM through 141 can run the cumulative
sql/deploy/upgrade_142_to_145_vm.sql with SQLCMD mode or sqlcmd -b.
The combined bundle is not atomic; each migration is rerunnable. Deploy matching
core/ and webapp/dist/ before restarting. Preserve VM-local secrets and uploads.

145 updates two save procedures and three Shipping triggers. Prior definitions
are archived with names ending in 145 in dbo.PackagingLayerMigrationArchive.
It changes no master values, transactions or pricing snapshots.

Regenerate the cumulative bundle using scripts/Build-VMUpgrade142To145.ps1,
then refresh release-files.sha256 after the final application build.

## Verification

    python tests/python/copy_dimensions_contract.py
    python tests/python/optional_shipping_d2_live_contract.py

The live contract creates separate desktop-test masters in an outer transaction,
verifies optional D2, current material selection, height and formula guards, then
rolls back. Browser coverage exercises normal and nested master editors, retained
three-slot layout and pricing calculator selection.

Verification completed: 94 focused browser checks, 12 Copy Dim. contracts,
5 rollback-only optional-D2 live contracts, 9 reference/currency contracts,
and the 280-check feature and 309-check original replica audits passed.
The build, Python compilation, pre-145 archived-definition upgrade test and
two cumulative 142-145 bundle reruns passed. Original Bucket master versions
and business-record counts were unchanged; QA fixtures were rolled back.
