# Number display

Webapp master tables, Opportunity and Packaging Request tables, and Product Mix calculated summaries use shared number formatting.

- Commas separate thousands, and a period separates decimals (for example 10,000,000.00).
- Monetary amounts: exactly 2 decimals (Unit price, Unit USD price, Shelf price, Cost and PM cost).
- Quantities, weights, percentages, dimensions and exchange rates: at most 3 decimals, without unnecessary trailing zeros.
- Null stays blank/dash, distinct from zero. Codes, IDs and free text are not treated as decimal amounts.
- Currency suffixes and thousand separators are screen-only. Master Excel exports contain undecorated numeric values with original precision, using numeric cells for amounts, rates, weights and quantity ranges.

This is display-only rounding, using decimal string arithmetic for SQL decimal values. Database precision, calculation formulas, audit history and Excel Local Update values retain original precision. Rounding edit inputs or writable workbook values would risk changing data on an otherwise unrelated save.

Master-data edit controls now display grouped numbers on blur and validate new entries: monetary values allow 2 decimal places; other decimal fields allow 3. Grouping is removed while typing and from save payloads. Excess decimals show an error and block saving rather than silently rounding user input. Untouched existing values retain their original database precision when another field is saved.
