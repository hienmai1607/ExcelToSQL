param(
    [string]$WorkbookPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'Sales_Template.xlsm'),
    [string]$ModulePath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'modCustomerBridge.bas')
)

$ErrorActionPreference = 'Stop'
$workbookFile = (Resolve-Path -LiteralPath $WorkbookPath).Path
$moduleFile = (Resolve-Path -LiteralPath $ModulePath).Path
$workspace = Split-Path $workbookFile -Parent

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupFile = Join-Path $workspace ("Sales_Template.before_customer_lookup_fix_$stamp.xlsm")
Copy-Item -LiteralPath $workbookFile -Destination $backupFile

$excel = $null
$workbook = $null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $workbook = $excel.Workbooks.Open($workbookFile)

    $existing = $null
    foreach ($component in $workbook.VBProject.VBComponents) {
        if ($component.Name -eq 'modCustomerBridge') {
            $existing = $component
            break
        }
    }
    if ($null -ne $existing) {
        $workbook.VBProject.VBComponents.Remove($existing)
    }
    [void]$workbook.VBProject.VBComponents.Import($moduleFile)

    # This is the exact call path that previously failed at Validation.Add.
    $excel.Run("'$($workbook.Name)'!ConfigureCustomerSheet")

    $marketName = $workbook.Names.Item('CustomerMarketCodes').RefersTo
    $currencyName = $workbook.Names.Item('CustomerCurrencyCodes').RefersTo
    $marketValidation = $workbook.Worksheets.Item('Customer').Range('C2').Validation.Formula1
    $currencyValidation = $workbook.Worksheets.Item('Customer').Range('D2').Validation.Formula1
    if ($marketName -notmatch "_Lookups'?!\`$D") { throw "Market name is invalid: $marketName" }
    if ($currencyName -notmatch "_Lookups'?!\`$F") { throw "Currency name is invalid: $currencyName" }
    if ($marketValidation -ne '=CustomerMarketCodes') { throw "Market validation is invalid: $marketValidation" }
    if ($currencyValidation -ne '=CustomerCurrencyCodes') { throw "Currency validation is invalid: $currencyValidation" }

    $workbook.Save()
    "PASS: ConfigureCustomerSheet completed"
    "MarketName=$marketName"
    "CurrencyName=$currencyName"
    "Backup=$backupFile"
}
finally {
    if ($null -ne $workbook) { $workbook.Close($false) }
    if ($null -ne $excel) { $excel.Quit() }
    if ($null -ne $workbook) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) }
    if ($null -ne $excel) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
