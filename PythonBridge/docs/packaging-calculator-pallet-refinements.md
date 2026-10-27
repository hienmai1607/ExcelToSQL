# Packaging calculator and pallet refinements (26 October 2026)

## Changes

- Remove Delete controls for request headers, parent/standalone items and nested
  children from Packaging Requests. No records are deleted by this UI change.
- Packaging calculator results now remain in the non-scrolling footer alongside
  Calculate, Apply and Close. Pallet pricing uses the same catalog, component-card,
  scrollable-body and footer layout, including the saved read-only view.
- Response Packaging Type master buttons use 28 x 32 px controls beside the
  calculator button. Normal and narrow layouts retain accessible labels.

## Pallet preview diagnosis

The capacity request previously recognised only explicit Length/Width names.
Diameter + Height therefore never triggered it. Both frontend and saved-response
API geometry now support an explicit Dia/Diameter as a square shipping envelope.
The first diameter slot is used, retaining compatibility with the old duplicate
Dia / dummy D2 workaround. Explicit rectangular geometry is never overwritten,
and arbitrary missing widths are not guessed. User formulas remain unchanged.

Selecting a pallet also clears its old pricing capture. The preview previously
required that capture's tare, leaving suggestions and gross weight blank until
pricing was applied. Pallet choices now include maintained base tare, allowing
an editable response to show a clearly labelled base-only weight preview.
Applied pallet pricing supplies the complete accessory-inclusive tare. Approved
and read-only responses never substitute a live master tare for a missing capture.

Applying pallet pricing no longer erases manually entered cartons/layer and
layers/pallet. Selecting a different pallet still clears obsolete counts and plans.
Server save validation continues to check height, fit and maximum payload.

Read-only verification of PCR-33169's saved Bucket used a 150 x 150 x 500 mm
envelope, 0.45 kg gross per unit and a 1118 x 1118 x 150 mm pallet with 20 kg tare.
At maximum height 2500 mm, the API proposes 49 cartons/layer, 4 layers/pallet,
196 cartons and 108.2 kg loaded gross, below the maintained 1200 kg limit.
No original master values or transactions were changed for this check.

## Verification and deployment

131 focused browser checks passed, including desktop/mobile footer arrangement,
master button size, manual counts, gross weights, missing pricing, read-only
snapshot isolation and request families. Four geometry contracts, five payload
contracts and thirteen planner contracts passed. The 280-check current-schema
feature audit and 309-check reference audit passed with rollback cleanup and
originals unchanged. The final application build and Python compilation passed.

Deploy matching core/ and rebuilt webapp/dist/, restart the API, then hard-refresh
the browser. There is no new SQL migration for these changes.
