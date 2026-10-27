# Tare mass units per material Base UoM (150)

New choices are g and kg with the denominator taken from the material Base UoM: g/EA and kg/EA; g/m² and kg/m²; g/LM and kg/LM; or the other selected Base UoM. Database/API values store only the selected mass unit (`g` or `kg`). Material and pricing displays append the Base UoM. Excel choices use g/kg alongside the material Base UoM column.

Grams are divided by 1,000 before contributing to packaging, pallet or container gross weight. Count formulas use the physical consumption quantity in the material Base UoM. Area consumption is converted to an area Base UoM where necessary. Pallet accessories use the maintained consumed area and applicable unit conversion. Missing conversions do not silently become zero tare.

Legacy kg/EA and kg/m2 values and saved snapshots retain their original meaning. The editor shows the corresponding mass selection when its saved denominator matches Base UoM. A mismatched legacy basis remains explicitly marked as saved rather than being relabeled. New choices follow Base UoM. Changing the mass selection interprets the entered tare weight in that chosen unit; it does not convert the typed amount automatically.

## Database deployment

`sql/150_material_tare_mass_units.sql` extends the PackagingMaterial tare check constraint to accept g/kg while retaining the existing legacy values and null/weight validation. It requires 149. No material amount, rowversion, price or captured snapshot is rewritten.

The user approved desktop application on 2026-10-28. Migration 150 was applied and rerun successfully; five business table hashes were unchanged. VM deployment still requires migration 150 before new g/kg entries can be saved. Missing migration is rejected with a clear 422 before any material write. Deploy matching API/frontend files, restart the API and refresh browsers after applying it.

## Validation

- `python tests/python/material_tare_units_contract.py`: seven tests for gram/kg equivalence, area and count consumption, other Base UoMs, zero/missing values, legacy behavior, API save/reopen, migration reruns and constraint/fixture restoration after rollback.
- `python tests/python/material_tare_grams_audit.py --quiet`: replay 10075/10094 with compatible replica material tares converted to grams; 310 checks pass, including pricing, pallet and Mix gross weights and independent costing. The schema change and all fixtures roll back; originals remain unchanged.
- Focused browser tests verify EA, m² and LM labels, selected mass-unit payloads and legacy denominator handling.

Response editors now share the refreshed Packaging Type list with Save validation after inline edits and creates. This prevents a newly selected type from being displayed while Save still checks an older list. The browser regression reproduces a renamed Secondary type and verifies that review works without reopening the request.
