# Opportunity USD exchange rates

The Opportunity overview and Create/Edit header now use:

- Exchange rate VND per USD: 1 USD equals this many VND.
- Customer currency: read-only, referenced from Customer Master.
- Exchange rate Customer Currency per USD: manually entered units of Customer currency per 1 USD.

The independent Opportunity Currency selector and generic Currency column are removed. New fields are required in the web entry and current Excel Local Update form. Rate values remain numeric in exports; currency suffixes are screen-only.

Apply sql/37_opportunity_usd_rates.sql after migration 36. Legacy USD-based rates are copied into the new VND-per-USD field; other currency rates are not guessed. Customer Currency rates remain blank until maintained. Existing legacy SQL fields remain for older interfaces and Packaging Request snapshots; new VND rate writes synchronize that legacy USD-based pair.

Customer Currency rate records the currency it was entered for. If Customer Master currency later changes, the overview shows the Customer's new currency and leaves the previous currency's rate blank until maintained again. It does not convert shelf prices automatically. Existing Packaging Requests retain their frozen request-time currency information.

Both new rates are covered by Opportunity change history, RowVersion and Draft-only write rules. Deploy the API and built webapp, restart the API to refresh cached lookups, and download a fresh Opportunity Local Update workbook. Old workbooks must be replaced because Currency is no longer editable.
