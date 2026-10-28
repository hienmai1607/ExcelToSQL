# TCB pallet FX precision hotfix

A captured pallet amount converted using the Opportunity exchange rate can produce a repeating decimal: 300,000 VND / 26,500 = 11.32075471698113207547169811 USD. Commercial validation then constructed `Inputs` with that derived amount, while TCB money accepts at most 19 total digits and six decimal places. This blocked entry/preview/save with `decimal_max_digits` despite valid user input.

The API now normalizes the derived pallet default to six decimal places with decimal half-up rounding before exposing it and before constructing TCB inputs. The example becomes 11.320755 USD per pallet. Amounts already within six decimals retain their value and formatting. Zero remains authoritative, missing prices remain blank, and Mix children do not receive a separate pallet charge. Captured material prices, exchange rates and pricing snapshots are unchanged. Entered money limits remain strict.

Deploy the matching `core/` files and restart the API, then reopen TCB. No SQL migration or frontend rebuild is required. Databases through 151 do not need another SQL script.

Validation: exact error reproduced before the fix; five new regressions cover regular and Mix parent entry, rounding, missing/zero/child behavior, strict entered-money limits, and real SQL read/validation/save/reopen with transaction rollback and original-row restoration. Nineteen existing TCB math/loss/API tests, nine captured-pricing/currency tests, and the 309-check costing replica audit pass; fixture cleanup and original data preservation are confirmed.
