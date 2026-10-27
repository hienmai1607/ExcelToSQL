# Packaging reference copy and manager review (26 October 2026)

Desktop DESKTOP-5BGMJSC / test has migration 144 applied after 142-143.
Deploy matching core/ and rebuilt webapp/dist/ and restart the API; refreshing
only the browser does not load changed Python handlers.

## Changes

- Copy Dim. calculators display compact captured dimension text, not disabled boxes.
- Calculator-level reference selection is replaced by the item header's Copy
  Reference icon. History remains accessible through the existing history icon.
- Copy each available cumulative Primary/Secondary/Tertiary/Quaternary section
  and Palletization independently, or use one source for all available sections.
  Sections absent from that source are explicitly left unchanged.
- Configuration, dimensions and material selections are copied. Prices resolve
  against current effective masters, preserving the reference vendor, currency,
  basis and quantity tier and choosing the newest applicable quote. Missing prices
  remain blank; materials are retained for review rather than silently omitted.
- Copied pallet pricing is recalculated and captured inside the response save
  transaction. Historical source pricing and load-plan results are never copied
  as new authoritative totals. Load plans must be recalculated for the target.
- A directly authorized Packaging Manager can edit a submitted (Pending Review)
  response, add an optional note, then confirm to save and approve the whole family
  atomically. All family versions and completion rules are checked. A partial family
  save rolls back; approved/canceled rows remain locked. Existing PIC self-approval
  restrictions remain in force except for Admin.
- OPP-2026-10053 Item 1 had captured 400,000 VND without a USD quote value.
  TCB now derives 16 USD/pallet using its opportunity FX of 25,000 VND/USD.
  A captured USD value remains authoritative. Missing FX stays blank; no fallback
  to today's unrelated quote or an older request is used.

## VM upgrade

Back up the application database and stop the API first. A VM already through 141
can run sql/deploy/upgrade_142_to_144_vm.sql in SQLCMD mode (or sqlcmd with -b).
A VM already through 143 can run only sql/144_packaging_reference_review.sql.
The combined bundle is not atomic, but each migration is rerunnable.
Deploy matching application files before restarting; keep VM-local secrets/uploads
and LOCAL_AI_ENABLED=0. Do not use this bundle to initialize a new database.

144 adds copied-reference storage and a shared response-editability predicate,
then updates the three response/pricing edit guards and the cumulative pricing-reference
check. Their prior definitions
are archived in dbo.PackagingLayerMigrationArchive under names ending in 144.
The archive is not a substitute for a full pre-deployment database backup.

Generate the combined artifact with scripts/Build-VMUpgrade142To144.ps1, then
refresh deployment/company/release-files.sha256 after the final application build.

## Focused verification

    $env:PYTHONPATH='core'
    python tests/python/packaging_reference_contract.py
    python tests/python/packaging_reference_live_contract.py --quiet
    python tests/python/opportunity_replica_audit.py --quiet

The live audit creates separate QA masters and transactions, exercises all four
layers and Palletization, checks newest/missing prices, verifies non-Admin manager
family completion and partial-save rejection, then rolls everything back and
verifies original records are unchanged.

Browser coverage includes separate/all-section copy, retained unpriced materials,
manager notes, copied dimensions without inputs, responsive layout and pallet/TCB
pricing. The completed-response read-only test remains separate from the new
submitted-response manager-edit tests.

Final verification: 162 focused browser tests, 9 reference-input/currency contracts,
280 current-schema live feature checks, and the separate 309-check reference audit
passed. The application build and Python compilation passed. All QA records were
rolled back and original records were verified unchanged. The final VM bundle
passed two desktop reruns without changing business-record counts.
