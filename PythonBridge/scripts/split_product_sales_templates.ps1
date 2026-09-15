param(
    [string]$ProductWorkbookPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'Product_Template.xlsm'),
    [string]$SalesWorkbookPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'Sales_Template.xlsm')
)

$ErrorActionPreference = 'Stop'
$productPath = (Resolve-Path -LiteralPath $ProductWorkbookPath).Path
$salesPath = (Resolve-Path -LiteralPath $SalesWorkbookPath).Path
$workspaceRoot = Split-Path $salesPath -Parent
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$productBackup = Join-Path $workspaceRoot "Product_Template.before_split_$timestamp.xlsm"
$salesBackup = Join-Path $workspaceRoot "Sales_Template.before_product_split_$timestamp.xlsm"

foreach ($lockName in @('~$Product_Template.xlsm', '~$Sales_Template.xlsm')) {
    if (Test-Path -LiteralPath (Join-Path $workspaceRoot $lockName)) {
        throw "$lockName exists. Close both workbooks before running the split."
    }
}

Copy-Item -LiteralPath $productPath -Destination $productBackup
Copy-Item -LiteralPath $salesPath -Destination $salesBackup

function Remove-WorksheetIfPresent {
    param($Workbook, [string]$Name)
    $sheet = $null
    try { $sheet = $Workbook.Worksheets.Item($Name) } catch { }
    if ($null -ne $sheet) {
        # Excel can reject Worksheet.Delete through COM when the target
        # workbook/sheet is not active. A very-hidden sheet cannot be activated,
        # so make it visible immediately before removing it.
        $Workbook.Activate()
        if ($sheet.Visible -ne -1) { $sheet.Visible = -1 }
        $sheet.Activate()
        $sheet.Delete()
    }
}

function Remove-ModuleIfPresent {
    param($Workbook, [string]$Name)
    $component = $null
    try { $component = $Workbook.VBProject.VBComponents.Item($Name) } catch { }
    if ($null -ne $component) { $Workbook.VBProject.VBComponents.Remove($component) }
}

function Remove-WorkbookNameIfPresent {
    param($Workbook, [string]$Name)
    $definedName = $null
    try { $definedName = $Workbook.Names.Item($Name) } catch { }
    if ($null -ne $definedName) { $definedName.Delete() }
}

function Get-ComponentNames {
    param($Workbook)
    @($Workbook.VBProject.VBComponents | ForEach-Object { $_.Name })
}

function Assert-ButtonMacro {
    param($Workbook, [string]$SheetName, [string]$MacroName)
    $actions = @($Workbook.Worksheets.Item($SheetName).Shapes | ForEach-Object {
        try { $_.OnAction } catch { '' }
    })
    if (-not ($actions | Where-Object { $_ -like "*$MacroName" })) {
        throw "$SheetName button assignment is missing: $MacroName"
    }
}

$excel = $null
$workbook = $null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false

    # Product workbook: Product is the only business sheet and module.
    $workbook = $excel.Workbooks.Open($productPath, 0, $false)
    foreach ($name in @(
        'CustomerCurrencyCodes',
        'CustomerMarketCodes',
        'OpportunityCustomerNames',
        'OpportunityProductCodes'
    )) {
        Remove-WorkbookNameIfPresent $workbook $name
    }
    foreach ($sheetName in @('Customer', 'Opportunity', '_Lookups')) {
        Remove-WorksheetIfPresent $workbook $sheetName
    }
    foreach ($moduleName in @('modCustomerBridge', 'modUnifiedOpportunityBridge')) {
        Remove-ModuleIfPresent $workbook $moduleName
    }
    $workbook.Save()
    $workbook.Close($false)
    $workbook = $null

    # Sales workbook: Product is maintained in its own workbook. The hidden
    # lookup sheet remains because Opportunity needs Product codes and Customer
    # needs Market/Currency choices.
    $workbook = $excel.Workbooks.Open($salesPath, 0, $false)
    Remove-WorksheetIfPresent $workbook 'Product'
    Remove-ModuleIfPresent $workbook 'modProductBridge'
    $workbook.Save()
    $workbook.Close($false)
    $workbook = $null

    # Reopen both read-only and verify the resulting contracts.
    $workbook = $excel.Workbooks.Open($productPath, 0, $true)
    $productSheets = @($workbook.Worksheets | ForEach-Object { $_.Name })
    if ($productSheets.Count -ne 1 -or $productSheets[0] -ne 'Product') {
        throw "Product workbook sheets are incorrect: $($productSheets -join ',')"
    }
    $productModules = Get-ComponentNames $workbook
    foreach ($required in @('JsonConverter', 'modHttpJson', 'modProductBridge')) {
        if ($productModules -notcontains $required) { throw "Product workbook is missing module: $required" }
    }
    foreach ($obsolete in @('modCustomerBridge', 'modUnifiedOpportunityBridge')) {
        if ($productModules -contains $obsolete) { throw "Product workbook retained module: $obsolete" }
    }
    if ($workbook.Names.Count -ne 0) { throw 'Product workbook retained unrelated defined names.' }
    Assert-ButtonMacro $workbook 'Product' 'SaveProductSheet'
    Assert-ButtonMacro $workbook 'Product' 'RefreshProductSheet'
    $workbook.Close($false)
    $workbook = $null

    $workbook = $excel.Workbooks.Open($salesPath, 0, $true)
    $salesSheets = @($workbook.Worksheets | ForEach-Object { $_.Name })
    foreach ($required in @('Customer', 'Opportunity', '_Lookups')) {
        if ($salesSheets -notcontains $required) { throw "Sales workbook is missing sheet: $required" }
    }
    if ($salesSheets -contains 'Product') { throw 'Sales workbook retained the Product sheet.' }
    $salesModules = Get-ComponentNames $workbook
    foreach ($required in @('JsonConverter', 'modHttpJson', 'modCustomerBridge', 'modUnifiedOpportunityBridge')) {
        if ($salesModules -notcontains $required) { throw "Sales workbook is missing module: $required" }
    }
    if ($salesModules -contains 'modProductBridge') { throw 'Sales workbook retained modProductBridge.' }
    Assert-ButtonMacro $workbook 'Customer' 'SaveCustomerSheet'
    Assert-ButtonMacro $workbook 'Customer' 'RefreshCustomerSheet'
    Assert-ButtonMacro $workbook 'Opportunity' 'SaveUnifiedOpportunity'
    Assert-ButtonMacro $workbook 'Opportunity' 'RefreshUnifiedOpportunity'

    "ProductBackup=$productBackup"
    "SalesBackup=$salesBackup"
    "ProductSheets=$($productSheets -join ',')"
    "ProductModules=$($productModules -join ',')"
    "SalesSheets=$($salesSheets -join ',')"
    "SalesModules=$($salesModules -join ',')"
    'PASS: Product and Sales templates split successfully.'
}
finally {
    if ($null -ne $workbook) { $workbook.Close($false) }
    if ($null -ne $excel) {
        $excel.Quit()
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
    }
}
