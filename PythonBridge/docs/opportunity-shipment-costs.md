# Opportunity shipment and USD cost inputs

Product Info uses one desktop row, with responsive wrapping on smaller screens.
The item editor has a separate collapsible **Shipment, Logistics, Co-Man & Others info**
section. Contextual help appears beside the field it explains. Routine USD,
percentage and months inputs do not have repetitive info icons.

## Ownership and values

- A regular product maintains its own section.
- A Mix parent owns the whole section; it is hidden on Mix children.
  No costs or shipment selections are duplicated onto child Opportunity rows.
- After an item is sent for packaging, Container Type and Loading request
  stay locked. Incoterm, Port of Entry and all Logistics, Co-Man
  and Others inputs remain editable on regular products and Mix parents.
  Product Info and Packaging requirements remain locked; children still inherit
  read-only. Existing Draft workflow, access and row-version checks still apply.
- Shipment-only updates do not resubmit protected packaging fields or alter
  already-captured PCR selections. The editing exception needs no separate migration; name-only ports require 90.
- Freight and the other USD-labeled inputs remain USD. Import clearance and new
  Port-WH and WH Cost inputs use customer currency, with an adjacent USD preview.
  Initial Design offers USD (default) or customer currency. Analysis converts
  customer amounts once using the Opportunity customer-currency-per-USD rate
  (the VND rate for VND, or 1 for USD). A missing rate leaves calculated costs
  incomplete. Stored financial inputs are never replaced by rounded previews.
  Amounts support two decimal places; percentages are 0–100. Interest months
  is a nonnegative whole number.
- These are stored inputs, not a landed-cost or margin calculation engine.
- Shipment Incoterm choices are CFA, DDP, EXW and FOB.
- Container Type replaces Configuration request and Container size in the editor.
  Choices are 20DC, 20RC, 40DC, 40HC and 40RHC. Loading request remains
  Pallet load/Floor load/Both. Container Type and Pallet size are required for
  new or fully edited root items, including floor loads. Mix children inherit.
  The internal ContainerRequest and ConfigurationRequest names are unchanged;
  ContainerSizeFT is derived for compatibility, not a separate user input.
  Legacy family/size pairs resolve automatically only when unambiguous. Existing
  Dry/40FT and Both requests require an explicit type choice on the next full edit.
  Shipment-only cost edits and workflow commands preserve legacy requirements.

## Port of Entry master

Shared masters > Ports of Entry supports Customer, Market, Port name
and Active/Block status. Admin maintains records; Opportunity/Customer roles can
read them. Updates require the current row version.

Opportunity choices include active ports matching both the selected Customer and
its current Market. A previously saved port remains preserved if it later becomes
unavailable; a new selection must match current active scope. Blocking a master
record does not delete historical references. Port codes are no longer shown,
submitted or required. Migration 90 keeps historical code values internally and
preserves Port IDs, row versions and Opportunity links; new records use names only.

## Packaging Request snapshots

New PCRs capture the exact Container Type, Loading request and derived size once.
Mix children requested alone still capture their Opportunity parent's selections.
Later Opportunity edits do not change existing PCR snapshots. Exact-type PCRs
permit only that type in response selections and incoming loading profiles.
Older family/size snapshots retain their historical response options:

| Container size | Dry response choices | Reefer response choices |
| --- | --- | --- |
| 20FT | 20DC | 20RC |
| 40FT | 40DC, 40HC | 40RHC |

There is no new 40RC type. Legacy PCRs without a size snapshot keep their previous
container choices. Current requested size is enforced in both the response dropdown
and SQL save validation. Container capacities and loading formulas remain unchanged.

## VM deployment

### Shipment customer currency update (138)

For a VM already through migration 137, back up the database and application,
stop the API, and run **sql/138_shipment_customer_currency.sql** in the intended
database. Deploy matching **core/** and the entire rebuilt **webapp/dist/**,
then restart the API and hard-refresh the browser. Migration 138 is rerunnable;
it changes validation only, not saved costs, row versions or PCR snapshots.
The older combined 117-to-137 bundle does not contain migration 138.

Existing Port-WH/WH Cost USD amounts retain their original basis. The editor
shows them as saved USD beside an empty customer-currency input; entering a new
customer amount replaces the legacy USD basis. Clearing that replacement clears
the cost rather than restoring an old amount. Initial Design retains the saved
basis and excludes the inactive amount on save. Blank new designs default to USD.
Regular non-Mix products keep their own section; only Mix children hide it.
Excel and layouts expose explicit customer-currency columns while preserving
the historical USD columns. Initial Design accepts one basis, not both.

For a VM already migrated through **88**:

1. Back up its database and deployed application.
2. Stop the API/service before replacing code.
3. Select the intended application database and run
   **sql/89_opportunity_shipment_costs.sql**, then **sql/90_port_name_only.sql**. It is self-contained and has no
   local USE directive. Stop on any SQL error; do not launch mismatched code.
4. Copy matching **core/** source files and the entire rebuilt **webapp/dist/**
   directory, including index.html and hashed assets. Also copy the rebuilt
   **templates/Opportunity_Local_Update.xlsm** for local Excel downloads.
5. Keep the VM's environment, secrets, virtual environment, uploads and logs.
6. Restart the API/service and hard-refresh clients.
7. Maintain the required Customer/Market ports in Ports of Entry.

Earlier deployments must apply missing migrations through 88 first.
For the new required Container Type/Pallet behavior, apply migration
**sql/98_required_container_type_pallet.sql** after 97, then deploy matching
backend and frontend files and restart the API. Migration 98 is rerunnable and
does not rewrite Opportunity items or existing PCR snapshots.
Migrations 89 and 90 are rerunnable, add no financial backfill, and do not clear
history. Run 90 after any rerun of 89, because 90 supplies the current Port save
procedure signature. New Excel downloads include layout-based section headings,
editable/calculated/display-only colors and the same shipment editing rules.

Focused checks:
- tests/python/shipment_costs_contract.py
- webapp/tests/shipment.spec.ts
- webapp/tests/container-load.spec.ts
- webapp/tests/requirement-sections.spec.ts
- tests/python/required_container_type_contract.py

## Revised shipment cost inputs (migration 102)

Apply sql/102_shipment_cost_units.sql after 101, then deploy matching core and
rebuilt webapp/dist and restart the API. This rerunnable migration updates only
validation procedures; it does not rewrite saved financial inputs or PCRs.

- Floor load cost (USD/MT) is visible for Floor/Both only. Analysis charges
  USD/MT x each product's applicable weight in grams / 1,000,000. Pallet excludes
  this cost; Floor excludes pallet cost; Both combines both in one result.
- Clearance is entered in customer currency per pallet. USD/pallet is displayed
  next to the input using the Opportunity exchange rate. Analysis divides this
  USD amount by all smallest units per pallet. Existing USD/container amounts
  retain their original basis until a new customer-currency pallet amount is entered.
- Interest days / 30 / 12 replaces months / 12. Historical months display as
  days using 30 days/month and retain an equivalent calculation.
- Select Margin % of costs through Interest, or Margin USD/lb x product weight
  in grams / 453.59237. Only the selected basis is saved.
- Payment term days is informational and separate from Payment Term %.
- Co-Man fields are visible only for DDP; changing Incoterm hides but does not
  delete previously saved values.
- Packing Way quantities align with their matching layer sections, with multiplication
  signs between Primary, Secondary and Tertiary quantities, not clear buttons. Section headings use the
  item gutter, with I/II/III identifying packaging layers. Five-field desktop
  rows collapse to two or one column on narrower screens.

New inputs are available in Opportunity layouts and editable Excel columns;
TCB outputs remain calculated, display-only Excel columns.
