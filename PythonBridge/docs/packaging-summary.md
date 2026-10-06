# Packaging Summary

The tree icon beside an Opportunity item opens a read-only summary of its linked
PCR. Clicking a Mix child opens the parent tree and highlights that child. All PCR
pages are read, so collapsed or off-screen children are included. Child responses
come from the same PCR as the parent, not each child's newer current request.
Unapproved responses remain hidden from users without Packaging draft access.

The tree follows Primary → Secondary → Tertiary for the confirmed layers. Mix
children feed the Mix parent's Primary layer. The final parent layer branches to
palletization and/or floor load, then to the permitted container types. Each layer
shows its captured weight, type, dimensions, MOQ, own price and cumulative cost
in a two-column label/value table. Response status and numeric layer suffixes are
omitted; bold accent connectors emphasize quantities and flow.
Each saved container profile remains independent; missing profiles stay blank.

## Cost roll-up

Prices are per packaging unit, not vendor component prices. For a normal product,
with n1 Primary units per Secondary and n2 Secondary units per Tertiary:

- Primary cumulative cost = p1.
- Secondary cumulative cost = n1 × p1 + p2.
- Tertiary cumulative cost = n2 × Secondary cumulative cost + p3.
- Smallest product unit cost = p1 + p2 / n1 + p3 / (n1 × n2).

Only confirmed layers participate. Missing/hidden prices, missing currencies or
invalid quantities make the aggregate incomplete; they are never assumed zero.
A saved zero price is valid. Decimal arithmetic uses exact rational values until
display. Monetary fields show exactly two decimal places; quantities retain up to
nine decimal places. The summary converts all costs into the current Opportunity
customer currency, using its ExchangeRateVNDPerUSD and
ExchangeRateCustomerCurrencyPerUSD (both expressed as currency units per USD).
VND costs divide by the Opportunity VND rate to reach USD; USD costs use identity;
USD then multiplies by the customer rate. USD/VND target currencies use identity
or the VND rate respectively. Costs already in the customer currency need no FX.
For other supplier currencies, the saved layer pricing UnitUSDPrice supplies the
USD basis; today's supplier rates are never read. Missing rates or saved USD
values make affected costs incomplete, not zero. Conversion occurs before the
roll-up/allocation, with exact values preserved until display. Changing an
Opportunity master rate intentionally updates this converted summary, not the
saved PCR prices. When the customer currency is not USD, every monetary field
also shows its USD equivalent alongside, for example `10.00 AUD (6.67 USD)`.
The equivalent divides the exact customer amount by the Opportunity master rate
before rounding; USD customers see only one USD amount. Missing rates display
`USD unavailable`, without substituting a default rate.

Mix quantities use the immutable PCR ProductMixSnapshot, consistent with the
Product Master's net-weight semantics: each quantity counts smallest product
units, not outer child cartons. The diagram also shows the equivalent final child
package quantity when available.

For a Mix Product:

- Child contribution per mix unit = captured child quantity × child smallest-unit
  packaging cost.
- Parent own cost per mix unit follows the normal per-unit layer calculation.
- Shared parent cost per smallest child unit = parent own cost per mix unit /
  sum(captured child quantities).
- Each child's total smallest-unit cost = its own packaging cost + that shared
  parent cost. This is equal-unit allocation, explicitly selected by the user.
- The sum of child quantities × their allocated costs reconciles exactly to all
  child + parent packaging cost per mix unit, in each currency separately.

Pallet and container packaging subtotals multiply the final layer cumulative cost
by the captured carton counts. These are packaging subtotals, not freight costs.
Pallet cost is explicitly not configured and excluded, rather than treated as zero.
When Pallet Master pricing is introduced, capture that price/currency in the PCR
first, then allocate cost per pallet across its contained smallest units; do not
silently reprice historical summaries from today's master.

## Deployment

Deploy `core/opportunity_views.py`, `core/request_views.py` and the rebuilt
`webapp/dist` together, then restart the API and reload the webapp. The request
reader also exposes permission-guarded saved USD layer prices for conversion.
No new SQL migration is needed: the Python readers expose existing linked request and product
identifiers. Opportunity and request permissions remain on the existing readers.
