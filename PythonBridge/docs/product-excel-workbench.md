# Product Excel Local Update

In Products, select your layout, apply filters/sort, and choose **Excel Local Update**. The existing Export action still downloads a read-only .xlsx snapshot of the displayed page.

The new download is a real .xlsm with embedded VBA. It contains the current server page, selected column order, hidden other fields, hidden ID/RowVersion/original values, and a hidden configuration sheet. It does not embed passwords or the web user's identity.

## Using the workbook

1. Save the downloaded file locally and open it in Windows desktop Excel.
2. Enable macros only using your company-approved trust policy. Internet-downloaded macros can be blocked; ask IT to approve/sign the template or its distribution. Do not disable macro security globally.
3. Edit visible Product values. Existing changed rows are detected automatically, or use U in Command. D means Block, not permanent deletion.
4. On **Controls**, choose Save and confirm. Result/Message identify successful and rejected rows. Successful rows are not resent when retrying failed rows.
5. New Product reveals Product name, Category and Weight (g), and adds a C row.
6. Controls also provides Refresh, Filter, Previous/Next, page number, and rows per page (1–500). Filters run on the server; the chosen web sort applies before paging.
7. Refresh to see calculated weight, status and audit values. Refresh/page changes warn before discarding unsaved edits.

Product code is generated on Save and is display-only. Grade versions are maintained through the webapp Grade icon; Grade and Mix ratio are removed from this workbook. Download a fresh workbook after migration 27.

Weight (g) is editable. Weight (oz), created/updated fields are read-only. Do not rename or remove hidden field-key/metadata columns. Move entire columns when changing order. Do not sort only part of a record's columns: metadata must remain with its row.

A network error after Save may leave the result unknown. The workbook stores a pending flag before sending and blocks retries; refresh and reconcile whether creates succeeded before entering them again. Keep a copy of unsaved entries if reconciliation is needed.

Required Product columns (Product name, Category, Weight (g)) always remain selected in the web layout and visible in new downloads. Missing required columns from older layouts are restored without changing the order of other selected columns. Optional columns can still be hidden and reordered.

The workbook remains unprotected. Excel's native Hide command is not blocked; Save and Refresh restore required columns. Download a new workbook to receive updated macros.

## Server and security

- Product or Admin scope is required for reads, downloads and writes. Existing Product procedures enforce business rules, scope and RowVersion concurrency.
- Only changed editable fields are sent for updates. The shared SQL field-patch procedure preserves every omitted field exactly, including legacy Product Code capitalization.
- Workbooks use their own Windows identity and API authentication, not the identity of the person who downloaded the file. Development header mode is only for trusted local testing and is not secure authentication.
- Network access to the API is required. This is not an offline database client.
- Set EXCEL_API_BASE_URL on the API host when its externally reachable URL differs from the URL used for download. Do not use localhost for downloads intended for other laptops.
- API endpoints: /api/workbench/product-excel/download, /page, /save.
- Apply sql/27_product_grade_versions.sql after migration 26 to enable automatic Product codes and versioned Grade structures. No new Product audit-history feature is introduced.

## Deployment/build

Deploy templates/Product_Local_Update.xlsm with the Python API and rebuilt webapp/dist. Runtime generation edits workbook XML while preserving the VBA binary and buttons; the API VM does not need Excel installed.

To rebuild the base template on a developer desktop with Excel and approved VBA-project access:
powershell -File scripts/build_product_local_template.ps1

The script backs up an existing generated template and does not modify Product_Template.xlsm, Sales_Template.xlsm, or open user workbooks. Re-sign/reapprove the rebuilt VBA artifact per company policy.

Checks: tests/python/product_excel_contract.py, webapp/tests/product-excel.spec.ts, and scripts/test_product_local_template.ps1 with a disposable generated workbook. Live data writes should be verified using an agreed test Product before company rollout.
