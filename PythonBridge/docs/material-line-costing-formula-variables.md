# Per-material recipes and Product Loss variables

## Pricing defaults

Web Raw Pricing and Packaging Pricing default Price UoM from the selected Material's Base UoM. Users can choose another Price UoM afterward; choosing another Material resets the default. Lookups include UnitOfMeasure. This also works for a newly created inline Material.

Selecting USD, directly or via Vendor, sets exchange rate to 1 and makes it read-only. Other currencies clear the old rate and remain editable. Existing SQL price contracts already enforce USD = 1.

## Opportunity TCB Review

Processing is now controlled by the grade tree's Process checkbox; see process-grade-costing.md. A Process parent groups its raw descendants and owns one shared recipe. Unprocessed grades have no processing row. Legacy per-leaf processing remains compatible. Process Info displays each Process grade, its product ratio, RM ($/lbs), RM ratio, seasoning/salt price and ratio, oil price and ratio, Processing and calculated Line product ($/lbs) in one row. All recipe inputs are visible immediately; there are no expanders. Each line's ingredient ratios must total 100%.

Line cost = RM price × RM ratio / 100 + seasoning price × seasoning ratio / 100 + oil price × oil ratio / 100 + Processing.

Product cost = sum of final grade proportion × line cost. RM summary remains sum of final grade proportion × selected raw price, before recipes.

Inputs.MaterialCosts stores recipes by grade Path inside existing TCBCostInfo JSON. MaterialCostSnapshots records resolved line inputs and totals. No schema migration is required. Older global recipe inputs are inherited for each line until an explicit line edit is made, preserving existing totals. The summary sorts grade paths numerically by hierarchy (0/1/1, 0/1/2, 0/2/1, ..., 0/10). Ratio edits and newly added sibling grades retain quote/direct-price selections and recipes for unchanged leaf paths. New leaves start unpriced; removed, non-leaf, or replaced grade/material identities lose only their own pricing and recipe. Pricing selections retain existing quote, concurrency and permissions checks.

## Formula variable list

The list icon beside Product Loss opens the available variables and their meanings:
- NW: captured Opportunity Product net weight in grams, not a client-editable value or Packaging Response applicable weight.
- L1, L2, etc.: current product-loss rows as decimal ratios.

Formula evaluation uses the same bounded decimal parser for test, commercial preview and save. The server resolves NW from OpportunityItem.ProductNetWeightGrams. Missing or zero NW is rejected when referenced. Unknown variables, functions, powers and division by zero are rejected.

Existing percentage convention is unchanged: the expression result is multiplied by 100. For example, 1/NW at NW = 400 returns 0.25%.
