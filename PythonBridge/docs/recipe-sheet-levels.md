# Recipe Sheet processing levels

Details contains a separate recipe for each retained captured Level 1 nut grade. Each nut has a final blend percentage and sequential processing levels. Each level totals 100%; its first row is the raw nut or preceding level output. Output names are entered manually. The nut selector, blend ratio and each level output header use compact inline controls. Remove nut is not shown; each level has a Process Type and Loss (see below). Explanatory notes use info icons.

Full view expands every previous-level input, multiplies all level ratios and the nut blend percentage, and combines repeated Ingredient IDs into one priced row. Raw nut grades remain separate. Pricing, vendor, notes, direct prices and existing loss/buffer inputs remain in Full view. Identities and ratios are derived from Details by the API.

Example: 40% Cashews, 96% raw at Level 1 and 94.22% previous output at Level 2 contributes 36.18048% raw Cashews. Oil added at both levels contributes both weighted amounts to one oil row.

Existing flat sheets remain usable. Details setup initializes equivalent one-level recipes; users can name outputs and add further levels. Process names are no longer required; previously captured names remain compatible with saved snapshots. Pricing metadata is retained by GradePath or IngredientID. Six-place ratio serialization rounding is reconciled only for complete recipes.

Details are captured in CalculationJSON.RecipeDetails and copied into new revisions. The API validates and derives Full lines on preview, save, submission and approval. Draft permits incomplete levels; Price Ready and Final require complete levels. Existing return, manager approval and Sales acceptance rules remain in place. Loss/buffer behavior is unchanged.

Deployment: updated core and webapp/dist, restart API, refresh browser. No SQL migration is required for this change.


## Level Process Type and loss

Each level header has **Process type** (active Process Type Master entries) and **Loss (%)** to the right of Output name.

- Choosing a Process Type applies the Loss Process Master default for that nut. The row for the nut's exact captured grade (RawGradeID) wins; otherwise the "All grades" row is used; otherwise 0%. The loss stays editable, and changing the Process Type re-applies its default.
- A level's loss applies to every line entering it: its ingredients and the nut or previous-level output. Losses compound through later levels. Level 1 material in a two-level recipe is divided by both yields, while a Level 2 ingredient is divided only by the Level 2 yield. Example: Level 1 at 5% with Cashews 90% gives Buffer 90 / 0.95 = 94.74%.
- **Full view:** Ingredient Loss (%) is display-only and shows each line's combined loss, (1 − Ratio / Buffer) × 100. Repeated ingredients are combined. Buffer Ratio (%) defaults to the calculated value and is editable. A manual buffer is highlighted, keeps its value when Details change, and can be reset to the calculated value; its tooltip shows the calculated value. Buffers drive Total Qty, pricing tiers and Cost of FG with Buffer, and must not be below the line ratio.
- **Footer:** Loss by weight (%) covers the whole recipe, including nut buffers.
- **TCB:** the loss published as the default Seasoning Process Loss excludes nut-line buffers, because TCB applies its own raw-grade process losses. For sheets without level losses this equals the previous value.

Flat sheets with no Details keep their previous behaviour: Ingredient Loss is editable on ingredient lines and Buffer is calculated. Existing Details without a Process Type have 0% loss, so their ratios and prices are unchanged.

Storage: `ProcessTypeID`/`LossPct` per level in CalculationJSON.RecipeDetails, and an optional `BufferRatioPct` per line in LinesJSON. The calculation adds `LossByWeightPct` and `CalculatedBufferRatio`. No SQL migration is required. Deploy `core` and `webapp/dist`, then restart the API.

Checks: `python tests/python/recipe_level_loss_contract.py`, `webapp/tests/recipe-levels.spec.ts`.
