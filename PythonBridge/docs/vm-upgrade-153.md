# VM upgrade 153: pallet requirement comments

Requires migration 152. Back up the VM database and stop the API before upgrading.

1. Run `sql/153_pallet_requirement_comments.sql` against the VM application database. The script has no hardcoded database name and can be rerun.
2. Copy the updated `core` and complete `webapp/dist` folders.
3. Restart the API, then hard-refresh the browser and sign in again.

The migration adds nullable `PalletSpecialComments` to Opportunity items and captured Packaging Request items. New requests capture the text from Packaging requirements. Existing snapshots remain blank and are protected against later changes. It does not change quantities, prices or existing comment values.

The application release also makes the four header date/rate fields equal in width, gives Description more space, keeps the Sales Port of Entry master button visible (disabled until Customer is chosen), and shows TCB version/item comparisons inside TCB Review with Back buttons. Comparison navigation preserves unsaved TCB inputs.

Port editing still requires the user's role to have **Ports of Entry: Edit**. The desktop test user `hien.sales` has the narrowly scoped **Sales - Port of Entry** role; database role assignments are not copied by deploying application folders.

Desktop review fixture (not VM production data): **OPP-2026-10328**, **PCR-33476**, **PRD-0000000612**. One standalone 400g product, four layers with 4 x 2 x 2 contained units, 6.4kg net and 7.52kg gross per final carton. Its response is Approved. The test fixture remains available for review.

The final release restores the previous Opportunity layout for every user, overriding any saved Testing preference. It groups each response layer's quantities, weights, dimensions and pricing together. Opportunity and Packaging Request requirements use matching layer colors, four equal-width fields per row, wider layer comments and full-width pallet comments. Packaging loss inputs sit beside their prices. In TCB grade editing, the first ratio in each sibling group is read-only and updates to 100% minus the remaining ratios; nested groups balance independently. Mix parent weight is derived from captured child weights and quantities in both the UI and API.

Desktop multi-item review fixture: **OPP-2026-10336**. Item 1 is a Mix family (child layers 3/2/1, parent Quaternary); items 2/3/4 are standalone products with 1/2/4 layers. Packaging requests **PCR-33490** through **PCR-33493** are approved and TCB results are saved. Fixture data remains on desktop and is not deployed by copying folders.

Release validation: 48 focused browser/model tests, 14 Python weight contracts, and the production frontend build passed. Live browser checks were read-only. The retained multi-item fixture passed 213 business/API checks before commit to the desktop test database.

Migration 153 is the only new SQL script in this release. If it has already been applied to the VM, deploy the folders and restart the API without another schema update.
