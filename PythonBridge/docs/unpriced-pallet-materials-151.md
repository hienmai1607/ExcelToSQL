# Pallet material availability before pricing

Active materials of the Pallet type with current, complete convertible Length/Width/Height are now selectable without any pricing record. Blocked materials and stale dimensions remain unavailable. Capacity proposals use material dimensions, tare and maximum payload before pricing exists.

The pallet pricing calculator shows matching unpriced materials with a blank price and an Add Packaging Price shortcut. Existing applicable prices provide Edit Packaging Price. Saving a new price refreshes the catalog; only real active effective prices can be selected or used in totals. Copy references and saved calculations continue using the priced catalog.

Migration 151 changes the shared footprint view to use active material dimensions independently of prices. It requires 150 and is rerunnable. Applied on desktop test on 2026-10-28, with five business table hashes unchanged. Existing materials, pricing and snapshots are not rewritten. VM requires the matching SQL, API and frontend deployment. Restart API and refresh browser after deployment.

Validation: rollback SQL/API tests cover unpriced choices and shared footprints, adding a price then calculating, capacity without a price, blocked material exclusion, and prevention of missing-price calculations. Browser regression exercises nested Add Pricing and refreshed selection. Existing costing replica audit passes 310 checks with fixture cleanup and original data unchanged.
