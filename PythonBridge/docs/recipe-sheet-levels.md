# Recipe Sheet processing levels

Details contains a separate recipe for each retained captured Level 1 nut grade. Each nut has a final blend percentage and sequential processing levels. Each level totals 100%; its first row is the raw nut or preceding level output. Output names are entered manually. The nut selector, blend ratio and each level output header use compact inline controls. Process Type and Remove nut are not shown. Explanatory notes use info icons.

Full view expands every previous-level input, multiplies all level ratios and the nut blend percentage, and combines repeated Ingredient IDs into one priced row. Raw nut grades remain separate. Pricing, vendor, notes, direct prices and existing loss/buffer inputs remain in Full view. Identities and ratios are derived from Details by the API.

Example: 40% Cashews, 96% raw at Level 1 and 94.22% previous output at Level 2 contributes 36.18048% raw Cashews. Oil added at both levels contributes both weighted amounts to one oil row.

Existing flat sheets remain usable. Details setup initializes equivalent one-level recipes; users can name outputs and add further levels. Process names are no longer required; previously captured names remain compatible with saved snapshots. Pricing metadata is retained by GradePath or IngredientID. Six-place ratio serialization rounding is reconciled only for complete recipes.

Details are captured in CalculationJSON.RecipeDetails and copied into new revisions. The API validates and derives Full lines on preview, save, submission and approval. Draft permits incomplete levels; Price Ready and Final require complete levels. Existing return, manager approval and Sales acceptance rules remain in place. Loss/buffer behavior is unchanged.

Deployment: updated core and webapp/dist, restart API, refresh browser. No SQL migration is required for this change.
