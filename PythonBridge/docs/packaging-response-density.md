# Nut Density and Used volume

Primary packaging response now includes editable Nut Density (g/ml) and
read-only Used volume (ml). Used volume equals the request item's frozen
net weight (g) divided by its density, not the current Product Master weight.

Density is optional for incomplete responses, must be positive, and supports
up to six decimal places (DECIMAL(18,6)). Zero, negative, non-finite and excessive
precision values are rejected. Missing density or net weight leaves volume
blank. Clearing density clears the calculated volume.

The web preview uses exact decimal arithmetic and rounds to six decimal places.
Only density is submitted. SQL calculates UsedVolumeML as a computed column,
so clients cannot supply or overwrite the result. Density and calculated-volume
changes are audited as response fields. Draft values are visible only to the
existing authorized response roles; Opportunity users see them after approval.
Normal PIC, stage and row-version checks remain in force.

Legacy response field lists, TVPs, Layout settings and Excel Local Update
templates are unchanged. Older saves that omit density preserve its value.

For VM deployment:

1. Run sql/58_packaging_response_nut_density.sql after SQL 57.
2. Deploy core/packaging_fields.py and core/request_views.py.
3. Deploy the rebuilt webapp/dist, restart the API, and refresh with Ctrl+F5.

The migration is repeatable and does not backfill or rewrite existing responses.
