$ErrorActionPreference='Stop'
$workspace=Split-Path $PSScriptRoot -Parent

foreach($test in @(
    'user_master_hardening_contract.sql',
    'user_master_product_contract.sql',
    'user_master_customer_contract.sql',
    'user_master_read_contract.sql',
    'opportunity_transaction_contract.sql',
    'opportunity_grid_contract.sql'
)) {
    & sqlcmd -S DESKTOP-5BGMJSC -E -C -d test -b -i (Join-Path $PSScriptRoot "sql\$test")
    if($LASTEXITCODE -ne 0){throw "SQL contract failed: $test"}
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'workbook\user_master_contract.ps1') `
    -ProductWorkbookPath (Join-Path $workspace 'Product_Template.xlsm') `
    -SalesWorkbookPath (Join-Path $workspace 'Sales_Template.xlsm')
if($LASTEXITCODE -ne 0){throw 'Workbook contract failed.'}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'workbook\opportunity_refresh_contract.ps1') `
    -SalesWorkbookPath (Join-Path $workspace 'Sales_Template.xlsm')
if($LASTEXITCODE -ne 0){throw 'Opportunity Refresh workbook contract failed.'}

& 'C:\Users\Admin\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m py_compile `
    (Join-Path $workspace 'core\auth.py') (Join-Path $workspace 'core\main.py') `
    (Join-Path $workspace 'core\schemas.py') (Join-Path $workspace 'core\db.py')
if($LASTEXITCODE -ne 0){throw 'Python compile contract failed.'}

& 'C:\Users\Admin\AppData\Local\Python\pythoncore-3.14-64\python.exe' `
    (Join-Path $PSScriptRoot 'python\user_master_runtime_contract.py')
if($LASTEXITCODE -ne 0){throw 'Python runtime contract failed.'}

foreach($contract in @(
    'opportunity_workflow_http_contract.py',
    'opportunity_grid_http_contract.py',
    'opportunity_document_batch_contract.py'
)) {
    & 'C:\Users\Admin\AppData\Local\Python\pythoncore-3.14-64\python.exe' `
        (Join-Path $PSScriptRoot "python\$contract")
    if($LASTEXITCODE -ne 0){throw "Python contract failed: $contract"}
}

'PASS: all Customer/Product User Master contracts'
