# Mix Product packaging ownership

Apply migration 86 after 85, then deploy the matching core and built webapp/dist.
The existing 45-85 VM bundle is unchanged. For the complete new upgrade, run
`sql/deploy/upgrade_086_to_088_vm.sql` once against a database already through 85.
It includes 86, 87 and 88 in order. See `docs/vm-upgrade-086-to-088.md`.

For a mix parent, each Primary/Secondary/Tertiary layer can use an active top-level
master type assigned to Secondary or Tertiary. Primary-only master types are not
new choices. A type assigned to Primary and Secondary remains eligible. Normal
Products and mix children still use matching master orders. The mix parent's final
layer retains the Shipping requirement. Existing saved choices are not rewritten.

Mix children keep independent packaging layers, packaging types, counts, material
pricing, and grade copies. Their Container request, Configuration request, Pallet
size, stacking and maximum height come from the parent Opportunity item. Child
editors hide these controls. API/SQL reject attempts to maintain them on children.
Opportunity reads resolve the parent's current requirements; new child Packaging
Requests capture those requirements even when the parent is not in the request.
Later parent edits cannot change an existing request's frozen specifications.

Shipping is required on the final packaging layer of normal/root products,
including a mix parent, using the eligible master-order rules above. A mix child's
last packaging type need not be Shipping. Its pricing calculator does not require
shipping D3 Height solely because it is the last layer; conversion formulas can
still require whichever measurements they reference. Shipping/Palletization
response controls and save inputs are parent-only.

Mix parent counts display No of Primary Mix Unit and No of Secondary Mix Unit.
Their info icons show the saved composition, for example
Mix Product = 2 x Almonds + 1 x Cashews.

The mix parent's Grades icon opens a read-only Product structure with Product Mix
and Grade tabs. Individual child grade copies can still be edited on the child
Opportunity item. This dialog never writes Product Master.

New requests capture ProductMixSnapshot, containing the saved mix version, child
Products, quantities, weights and grade copies. The snapshot cannot be edited.
Migration 86 does not rewrite old requests or pricing history and does not
reconstruct historical mix snapshots from today's Product Master.

## Mix parent volume and efficiency

The mix parent does not maintain Nut Density. Children still maintain their own
density in g/ml. Using the request's captured child quantities and weights:

- Total Used volume (ml) = sum(child quantity x child net weight g / child density).
- Mix Carton Efficiency (kg/m3) = sum(child quantity x child net weight g) / 1000
  / the last Shipping layer's captured Occupied m3.
- Relative mix carton efficiency % = Total Used volume ml / 1,000,000
  / the last Shipping layer's captured Occupied m3 x 100.

These composition sums follow the formulas above without multiplying by packing
counts. Percentages display two decimal places. Child volume is summed before
rounding. Missing child density leaves total volume and relative efficiency blank;
weight-based efficiency can still calculate if all captured weights are available.
Normal Products and mix children keep their existing volume/efficiency formulas.

Child densities must be from the same Packaging Request, including children on
other pages. Another request or today's Product Master cannot fill missing data.
Draft child densities are hidden from Opportunity-only users even when the parent
response is approved. The matching last-layer pricing snapshot supplies occupied
volume; changing its type/layer count invalidates this geometry until repriced.

This calculation update needs the existing migration 86 structure snapshot, but
no additional SQL migration. Deploy core and the rebuilt webapp/dist together,
restart the API, and refresh the browser. No request history is deleted or backfilled.

Verification: mix_efficiency_contract, mix_parent_logistics_contract and the
Opportunity mix, Packing Way and Pricing Calculator Playwright suites.
