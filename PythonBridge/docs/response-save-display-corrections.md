# Response save and display corrections

The response save could fail with HTTP 500 when a new NutGradeDensity default
was created on a SQL connection with NOCOUNT OFF. INSERT row-count messages
preceded SELECT SCOPE_IDENTITY; direct fetchval read the non-query result.
grade_density now uses the existing result-set consumer, skipping row-count
messages and reading DensityID. Response and density/history saves retain
their existing transaction and concurrency behavior.

Regression: response_weight_density_contract.ResponseRevisionSQL.
test_new_density_default_saves_with_driver_rowcount_messages runs the actual
response-save path with NOCOUNT OFF, checks the response, default and history,
and rolls all fixture writes back. Existing default overwrite/stale/access
contracts also remain covered.

Stage Summary uses the shared UTC-to-Asia/Bangkok timestamp formatter for
requested, submitted and reviewed times (day month year, 12-hour AM/PM).
Shipment and Packaging section summary labels inherit the same heading weight.
Margin mode and value now occupy one inline field group; switching mode
continues to retain the separate percentage and USD/lb values.

Deploy matching core code and rebuilt webapp/dist; restart the API.
No additional SQL migration is required.
