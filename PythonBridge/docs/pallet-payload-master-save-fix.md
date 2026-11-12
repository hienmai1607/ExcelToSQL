# Pallet payload master save — 9 November 2026

## Symptom and cause

Saving a positive Max gross payload, such as 1,200 kg, on Packaging Material could
return `Layers / pallet exceed maximum height or maximum gross payload.`

The material-save API saved the rating, then looked up responses referencing that
pallet and called the response capacity validator inside the same transaction.
A historical response with invalid current layer/height/weight inputs therefore
rolled back a valid master edit. This could happen even when saving the same
rating again. Both master maintenance and its inline shortcut shared the bug.

## Change

Master maintenance validates the material and its positive, required Pallet
payload rating. It no longer runs response loading validation over referencing
transactions. Captured pallet prices, approved response quantities/rowversions
and saved load plans remain unchanged.

The existing response-save and submission paths still validate their counts,
height and gross payload against the current master rating. After lowering a
rating, an incompatible response must be recalculated before it can be saved or
submitted again. This does not rewrite previously approved snapshots.

## Validation

`tests/python/pallet_payload_master_contract.py` reproduced the exact message
through the real `material_save` API/SQL path using rollback-only desktop fixtures.
Five regression checks cover a 1,200 kg edit, a reduced rating, the inline-master
save, preserved response/pricing/load captures, missing-rating rejection and
continued response submission validation. No fixture changes are retained.

The focused capacity, pricing, unpriced-pallet and tare-unit suites also pass.
Legacy `pallet_layers_contract.py` / `response_pallet_defaults_contract.py` cannot
serve as current-schema integration checks: their setup reapplies a retired
PackagingType order constraint which rejects Quaternary, and the former also
expects manual Layers/pallet to be ignored. Those older contracts were not
rewritten as part of this master-save correction.

## Deployment

This is an API-only change in `core/packaging_api.py`. Copy the updated `core/`
folder to the VM and restart the API service and all workers. No SQL migration,
frontend rebuild, or change to existing transactions is required for this fix.
Retry the pallet edit after reopening its master form to obtain a current
rowversion.
