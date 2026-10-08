# Opportunity shipment and USD cost inputs

Product Info uses one desktop row, with responsive wrapping on smaller screens.
The item editor has a separate collapsible **Shipment, Logistics, Co-Man & Others info**
section. Contextual help appears beside the field it explains. Routine USD,
percentage and months inputs do not have repetitive info icons.

## Ownership and values

- A regular product maintains its own section.
- A Mix parent owns the whole section; children display inherited values read-only.
  No costs or shipment selections are duplicated onto child Opportunity rows.
- After an item is sent for packaging, Configuration request and Loading request
  stay locked. Incoterm, Port of Entry, Container size and all Logistics, Co-Man
  and Others inputs remain editable on regular products and Mix parents.
  Product Info and Packaging requirements remain locked; children still inherit
  read-only. Existing Draft workflow, access and row-version checks still apply.
- Shipment-only updates do not resubmit protected packaging fields or alter
  already-captured PCR selections. The editing exception needs no separate migration; name-only ports require 90.
- All dollar inputs are USD. They are not converted by customer exchange rates.
  Amounts support two decimal places; percentages are 0–100. Interest months
  is a nonnegative whole number.
- These are stored inputs, not a landed-cost or margin calculation engine.
- Shipment Incoterm choices are CFA, DDP, EXW and FOB.
- Configuration request is Dry/Reefer; Loading request is Pallet load/Floor load/Both.
  Existing stored transport values, including Both, remain visible and preserved.
  The internal database names ContainerRequest and ConfigurationRequest are unchanged.

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

New PCRs capture Configuration request, Loading request and Container size once.
Mix children requested alone still capture their Opportunity parent's selections.
Later Opportunity edits do not change existing PCR snapshots.

| Container size | Dry response choices | Reefer response choices |
| --- | --- | --- |
| 20FT | 20DC | 20RC |
| 40FT | 40DC, 40HC | 40RHC |

There is no new 40RC type. Legacy PCRs without a size snapshot keep their previous
container choices. Current requested size is enforced in both the response dropdown
and SQL save validation. Container capacities and loading formulas remain unchanged.

## VM deployment

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
Migrations 89 and 90 are rerunnable, add no financial backfill, and do not clear
history. Run 90 after any rerun of 89, because 90 supplies the current Port save
procedure signature. New Excel downloads include layout-based section headings,
editable/calculated/display-only colors and the same shipment editing rules.

Focused checks:
- tests/python/shipment_costs_contract.py
- webapp/tests/shipment.spec.ts
- webapp/tests/container-load.spec.ts
- webapp/tests/requirement-sections.spec.ts
