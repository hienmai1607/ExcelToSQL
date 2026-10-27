# Pallet materials and 3D loading

Deploy SQL 108 through 116 in order after 107 (including material tare, Admin override, pallet pricing and independent container plans). Deploy matching core files and rebuilt webapp/dist together, then restart the API. Use the application database explicitly with sqlcmd -b. The VM is not modified by local deployment.

## Maintenance

Container Type Master appears in Packaging for Admin only. Maintenance is enforced as Admin-only by the API even if another role has an old edit grant. Its design follows shared master headings, toolbar, filters, linked IDs, pagination and Review & save. Container lookup data remains readable from authorized response/planner screens. Maintain carrier-approved internal dimensions, door opening, total clearances and payload. No assumed container specifications are seeded.

Packaging Types now offers an exclusive Pallet order. It requires Single and Copy Dim., with no parent or Shipping flag. Pallet is separate from Primary/Secondary/Tertiary. Maintain materials under that type, a Length/Width/Height dimension definition, and effective vendor prices with Material dimensions. Only active, current prices with matching dimension versions and valid conversions to MM appear in the planner. Price selection locks the copied dimensions.

SQL 110 maps each old pallet to a material with code PAL-LEGACY-{ID}. Existing USD prices are migrated when maintained. Missing prices remain missing. Actual height did not exist in the old master: migrated price height is blank and must be verified before use. No historical pallet records or response snapshots are deleted. Pallet Master is removed from the sidebar; old response selections remain supported.

Verify prices and actual pallet height before selecting a priced pallet. Legacy mapping records preserve original length/width converted to MM.

## Planning and applying

Open a response and choose the 3D cube icon next to Container Load. The 3D palletization launcher/view is removed; normal pallet response fields remain. One item/size is supported per load. Final carton dimensions are read-only and derived on the server from saved pricing or legacy saved measurements. Save complete dimensions before planning. Carton gross weight, pallet tare and pallet load rating are separate from the product net weight.

Choose a container. Pallet data and packing settings come from the response; the container view calculates automatically from the server placement result. Drag to rotate; zoom, top view and reset use icons. Maximum container payload is displayed. Pallet-loaded containers represent each loaded pallet as a block. Advanced options expand on demand; normal desktop view fits without vertical scrolling. Floor previews now show a detailed back third and a grouped remaining block, with exact section totals for the complete load. See [complete-load visualization](container-load-visualization.md).

Save plan & apply to response stores an immutable planning snapshot and stages its selection in the response. Finish Review & save to select it for the response. Canceling response edits leaves its previously selected plan unchanged; the new snapshot remains in history. The assigned PIC or Admin can save a plan or change its selection on an unlocked item (Admin override requires migration 113). Concurrent item/container/price changes are rejected. Selecting a plan from another item is rejected. Selection changes have their own audit history.

A selected plan supplies carton/container, cartons/pallet, layers, pallet height and net-weight totals, including partial top layers imposed by the pallet weight rating. TCB Analysis uses its container result. TCB pallet-cost default uses the captured EA price when available; custom/unpriced plans do not invent a price. Master edits never recalculate historical plans. Editing response packaging geometry clears the staged plan; calculate and apply another plan.

Existing responses without a plan retain their manual capacities and old calculations. This preserves historical results, including the old 150 mm base assumption. New plans use the actual entered/copied pallet height.

## Calculation limits

The algorithm tests mixed orientation strips along both axes and returns a feasible rectangular layout, not a proven global optimum. No overlap or overhang is allowed. Missing gross weights/payload/rating are explicitly reported as unverified. Double stacking requires confirmation and enough height. Door checks use the loaded unit; double stacking assumes units enter separately and can be stacked inside. Handling access and load stability require operational confirmation.

The engine supports floor-loaded cartons and palletized loads. The Both configuration retains the existing floor-count response semantics. Mixed item sizes, irregular shapes and detailed load balancing are outside this version.

Automatic previews are non-mutating. Preview confirm explicitly captures an immutable setup and fills the response draft container totals; Review & save remains the final response save. Closing without confirmation discards temporary preview settings. Legacy saved plans remain available to existing response reads but are not loaded as editable setups in this viewer.

## Verification

Run:
- python -m unittest load_planning_contract load_planning_sql_contract
- npm.cmd test -- load-planning.spec.ts container-load.spec.ts packaging-type-master.spec.ts
- npm.cmd run build

SQL tests are restricted to the local test database and roll back schema and fixture records.

## Independent container feedback (116)

All active master container types are available for feedback. Standard response profiles are no longer restricted by request family or shipment size. Each container keeps a separate current plan and floor/pallet mode. Switching types restores that setup. Modes are labelled Floor-loaded cartons and Pallet loaded; the request is context, not a hard lock on the feedback proposal.

Migration 116 adds ResponseContainerLoadPlan, backfills existing selected plans without deleting history, and relaxes only the request-family/size restrictions on standard feedback. Type, quantity, authorization and version checks remain. Apply in the application database before matching backend and rebuilt webapp/dist; restart the API. Local test deployment does not update the VM.

Save the response family before recalculating: parent gross includes all weighted child final gross plus parent tare. Applying a plan revalidates saved carton dimensions, gross weight and pallet pricing. History remains immutable.

Save payloads include ContainerLoadPlanIDs (container ID to plan ID) and LoadPlanID for the active proposal. The server validates item/container ownership. Reads publish summary-only ContainerPlansJSON. Planner history includes current container plans plus the latest ten historical snapshots.

### Planner lookup resilience

Container types, pallet prices, saved setups and carton weights load with separate error handling. An unavailable optional lookup must not hide successfully loaded containers or carton gross weight. Errors identify the failing lookup; an empty active-container catalogue requires Admin maintenance. Request users retain read access to this catalogue without master-maintenance access.

When restoring a container setup with response-based weights, use the current saved response gross weight rather than the historical plan weight. Unknown gross weight is never replaced with zero: the planner explains that saved layer/child tare and quantities are required, and must be completed in the response. The pallet source identifies saved response pallet pricing including accessories; this source is locked so those accessory tares are preserved.

The 3D dialog shows the current response's carton count and gross weight per pallet as a read-only reference before calculation. After calculation, the preview summary also displays 3D gross per pallet. These values may differ because the geometric layout can use a different carton count. The response reference is display-only and never overrides the server's saved-weight, geometry or payload checks. Response volume and gross-weight displays use grouped numbers with up to three decimal places; display formatting does not modify the underlying quantities.

### Response cartons per layer

The 3D pallet calculation defaults to the response's Cartons / layer, rather than filling every geometric position. This positive whole-number input is persisted in the plan Inputs JSON as cartons_per_layer, and limits the pallet placement list before layer counts and weights are calculated. A count beyond geometric capacity is rejected. The viewer cannot edit or clear this count; maintain it in the main response. The underlying engine retains maximum-fit behavior for legacy plans without a count. Floor-loaded carton mode ignores this pallet-only setting.

Pallet height, pallet goods rating, container payload, door and stack checks still apply. A pallet goods weight limit can reduce the total carton count and produces a loading notice. No SQL schema migration is needed for this JSON field; deploy the updated backend together with the rebuilt webapp/dist.

### Preview confirmation and required loading mode

Automatic calculation does not save. Preview confirm is enabled only after a positive, current calculation. It revalidates the response version, PIC/edit permissions, material pricing, container version and loading requirement, then captures the immutable setup. Confirmation fills Container type, Pallet / Container, Carton / Container, Net weight / Container and Gross weight / Container in the response draft. The user still chooses Review & save to persist the response selection. Closing without confirmation makes no changes. Failed confirmation leaves the viewer open without updating the draft.

Each confirmed container setup is preserved independently when the response is saved. A changed preview input invalidates the result and disables confirmation until recalculated. The previous saved-setup picker remains removed.

Loading mode follows ConfigurationRequest: Pallet load permits only pallet mode, Floor load permits only floor mode, and Both permits either. Single-mode requirements disable the selector. Preview and confirmation APIs enforce the same restriction against the persisted request. Historical data is retained without rewriting old plans.

Deploy the rebuilt frontend and restart the Python API to load matching validation. No new SQL migration is required.

### Response-owned palletization settings

Cartons / layer is maintained and saved only in the main response, remains editable after preview confirmation, and is passed unchanged into 3D. Editing it invalidates the previously confirmed load and container-plan mappings. It is not overwritten by a 3D result.

The 3D sidebar no longer exposes Weight options, manual weight overrides, pallet material/price selection, pallet dimensions/tare editors, maximum loaded height, goods rating or Double stack controls. These come from the response and its saved pallet pricing. Double stacking follows the response stacking selection and remains subject to container height checks. The read-only Palletization summary shows Gross weight / Pallet, Cartons / Pallet and Loaded pallet dimension (length × width × total loaded height in mm). Before calculation it references the response; after calculation it displays the validated preview result. Loaded height includes the pallet base and carton layers.

Pallet-loaded previews require saved pallet pricing, response carton count/maximum height and complete saved carton weight. Missing data must be maintained in the response rather than entered in 3D. Preview confirm remains the explicit action to capture container totals into the response draft.

### Automatic container comparison

The viewer selects the current response container, or the first active container, and automatically previews all active container types for the permitted loading mode. Changing container or mode refreshes the displayed view without a Calculate button. The 90-degree rotation option is removed; geometric previews keep rotation enabled.

A compact table below the scene compares container type, pallet count, carton count, gross load weight, maximum payload and occupied volume. Rows select the corresponding 3D view. Results are cached per container and mode for the open dialog, with a short debounce and at most two preview calls in flight per batch. Late responses from a previous mode cannot replace the selected view. A failed row does not hide other results and offers Retry. No preview call saves data; Preview confirm is still required to capture the selected setup.

### Server-owned inputs and invalidation

Item preview and confirmation derive carton gross weight, final carton dimensions, cartons/layer, maximum loaded pallet height, stacking, and pallet/accessory dimensions and tare from the saved response. Client manual weight, pallet price and packing overrides cannot replace those sources. Save response changes before previewing; missing saved weights, count, height or matching pallet pricing produce a validation error. The independent geometric engine continues to support historical manual input records.

Pallet-pricing routes use Packaging Request page permissions. Read/preview requires display access; saving additionally requires request edit access and the existing assigned-PIC/Admin and row-version checks.

The shared response transaction compares persisted loading dependencies before and after every response save, including sparse Excel edits. Physical changes clear the active plan and all current container-plan mappings for the changed item and its parent. Immutable plan records remain in history; invalidations are audited. Unrelated note edits preserve existing selections. Full-form clients cannot reattach stale selections in the same physical-change save. Related parent rows are locked before child writes so concurrent parent confirmations and child updates serialize consistently. No SQL migration is required.
