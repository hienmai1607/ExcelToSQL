# Packaging Summary commercial costs (26 October 2026)

The Pallet cost row was a fixed future-feature placeholder even when the linked
PCR returned PalletPricingJSON. It now reads that saved pallet snapshot only.
Captured USD remains authoritative, including zero; local-only snapshots convert
using the Opportunity exchange rates. Customer-currency values include USD
equivalents, rounded once for display. No current master quote is fetched.

Read-only desktop verification of PCR-33169 / PRD-0000000161 found 400,000 VND
with no captured USD value. OPP-2026-10054 has VND/USD 25,000 and AUD/USD 1.595:
the result is 25.52 AUD (16.00 USD), independent of pallet loading quantities.

Each permitted container card now includes Fobbing fee / Container and
Freight / Container. Values come from the parent Opportunity item's commercial
ShipmentCostInfo, not from a child or an unrelated packaging response. Both
fields are maintained in USD and shown using the same Opportunity FX display.
They are shown even before capacity is configured. Missing amounts or rates do
not become zero; explicitly maintained zero is displayed as zero.

These costs are displayed separately. Packaging layer, smallest-unit, pallet
packaging and container packaging subtotals retain their existing scope and
exclude pallet cost, Fobbing and Freight. The disclaimer and help explain this.
The UI is read-only and existing draft/approved response visibility is unchanged.

Verification: 66 focused browser/model checks passed, including the original
missing-price symptom, legacy local-only captures, captured USD/zero, missing FX,
commercial fees without capacity, Mix allocation, and narrow-screen layout.
The application build passed. Desktop verification made no business writes.

Deployment: deploy rebuilt webapp/dist/ and hard-refresh the browser. No new SQL
migration or API restart is required specifically for these frontend changes.
