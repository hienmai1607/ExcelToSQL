# Pallet size choices (migration 114)

The request and response Pallet size dropdowns use active Pallet-order Packaging Materials with active, currently effective Packaging Pricing records. Material dimensions must match the current dimension definition version and include positive, convertible Length and Width. Names identify each axis; D1 is not assumed to be Length.

Dimensions are converted to millimetres. Labels show Length × Width, such as 1165 × 1165 mm; the stored size snapshot is 1165x1165mm. Different materials/vendors with the same physical Length and Width produce one size choice. Height, vendor and tare remain properties of the specific material/price selected in the 3D planner.

Maintain the Pallet Packaging Type, Material and Pricing measurements before creating requests. No sizes or prices are invented when these are missing. The legacy Pallet Master supplies no new dropdown choices. Previously saved legacy sizes remain readable and accepted for compatibility; their existing manual capacity profiles are retained. New sizes use 3D load plans for container capacities.

Migration 114 creates v_PalletSizeChoice and updates both request/response SQL validators and the Opportunity lookup. Legacy rows remain in the view only for compatibility and area lookup. New lookup responses filter to Material choices. Existing business records are not rewritten.

Apply after 113, deploy matching core files and webapp/dist, then restart the API. The local test database has been upgraded. The VM needs the migration separately.

Verification covers named Length/Width ordering, general unit conversions, decimal dimensions, duplicate price tiers, stale definitions, blocked materials, expired prices, request/response saves and area lookups. Browser checks cover dimension labels, canonical save values and empty-list guidance.
