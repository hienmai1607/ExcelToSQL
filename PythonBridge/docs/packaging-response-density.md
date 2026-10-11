# Nut Density and Used volume

Current defaults and deployment: [Response weight, Container Load and density defaults](response-weight-loading-density.md).

Used volume (ml) = Applicable Net weight (g) / Nut Density (g/ml). Applicable weight defaults to the immutable captured Product weight. Density is optional for incomplete responses, must be positive, and supports six decimals. Missing density leaves volume blank; clearing density clears it.

SQL calculates UsedVolumeML; clients cannot overwrite it. Browser previews use exact decimal arithmetic. Mix volume sums each child's applicable weight divided by its density, multiplied by captured mix quantity.

Migration 101 updates the computed expression without rewriting captured weights or backfilling density defaults. Shared defaults are created on a successful density save; existing mappings require the explicit update action. Response authorization, stages, row versions and audit history remain enforced.
