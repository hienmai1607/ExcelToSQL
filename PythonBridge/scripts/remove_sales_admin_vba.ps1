param(
    [string]$WorkbookPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'Sales_Template.xlsm')
)

$ErrorActionPreference = 'Stop'
$resolvedWorkbook = (Resolve-Path -LiteralPath $WorkbookPath).Path
$workspaceRoot = Split-Path $resolvedWorkbook -Parent
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $workspaceRoot "Sales_Template.before_admin_vba_cleanup_$timestamp.xlsm"
$obsoleteModules = @('modMarketBridge', 'modCurrencyBridge')
$requiredModules = @(
    'JsonConverter',
    'modHttpJson',
    'modCustomerBridge',
    'modProductBridge',
    'modUnifiedOpportunityBridge'
)

if (Test-Path -LiteralPath (Join-Path $workspaceRoot '~$Sales_Template.xlsm')) {
    throw 'Sales_Template.xlsm is open. Close Excel before running this cleanup.'
}

Copy-Item -LiteralPath $resolvedWorkbook -Destination $backupPath

$excel = $null
$workbook = $null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $workbook = $excel.Workbooks.Open($resolvedWorkbook, 0, $false)

    foreach ($moduleName in $obsoleteModules) {
        $component = $null
        try { $component = $workbook.VBProject.VBComponents.Item($moduleName) } catch { }
        if ($null -ne $component) {
            $workbook.VBProject.VBComponents.Remove($component)
        }
    }

    $workbook.Save()
    $workbook.Close($false)
    $workbook = $null

    $workbook = $excel.Workbooks.Open($resolvedWorkbook, 0, $true)
    $componentNames = @($workbook.VBProject.VBComponents | ForEach-Object { $_.Name })

    foreach ($moduleName in $obsoleteModules) {
        if ($componentNames -contains $moduleName) {
            throw "Obsolete module remains: $moduleName"
        }
    }
    foreach ($moduleName in $requiredModules) {
        if ($componentNames -notcontains $moduleName) {
            throw "Required module is missing: $moduleName"
        }
    }

    $expectedButtons = @{
        Customer = @('SaveCustomerSheet', 'RefreshCustomerSheet')
        Product = @('SaveProductSheet', 'RefreshProductSheet')
        Opportunity = @('SaveUnifiedOpportunity', 'RefreshUnifiedOpportunity')
    }
    foreach ($sheetName in $expectedButtons.Keys) {
        $sheet = $workbook.Worksheets.Item($sheetName)
        $actions = @($sheet.Shapes | ForEach-Object {
            try { $_.OnAction } catch { '' }
        })
        foreach ($macroName in $expectedButtons[$sheetName]) {
            if (-not ($actions | Where-Object { $_ -like "*$macroName" })) {
                throw "$sheetName button assignment is missing: $macroName"
            }
        }
    }

    [void]$workbook.Worksheets.Item('_Lookups')
    "Backup=$backupPath"
    "Modules=$($componentNames -join ',')"
    'PASS: obsolete Admin Master VBA removed; Sales workbook contract preserved.'
}
finally {
    if ($null -ne $workbook) { $workbook.Close($false) }
    if ($null -ne $excel) {
        $excel.Quit()
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
    }
}
