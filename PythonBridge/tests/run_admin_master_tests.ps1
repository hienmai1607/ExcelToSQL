$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent

foreach ($test in @(
    'admin_master_market_contract.sql',
    'admin_master_currency_contract.sql',
    'admin_master_identity_contract.sql'
)) {
    & sqlcmd -S DESKTOP-5BGMJSC -E -C -d test -b -i (Join-Path $PSScriptRoot "sql\$test")
    if ($LASTEXITCODE -ne 0) { throw "SQL contract failed: $test" }
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'workbook\admin_master_contract.ps1') -WorkbookPath (Join-Path $workspace 'Admin_Master.xlsm')
if ($LASTEXITCODE -ne 0) { throw 'Workbook contract failed.' }

'PASS: all Admin Master contracts'
