param(
    [string]$ProductWorkbookPath=(Join-Path (Split-Path $PSScriptRoot -Parent) 'Product_Template.xlsm'),
    [string]$SalesWorkbookPath=(Join-Path (Split-Path $PSScriptRoot -Parent) 'Sales_Template.xlsm'),
    [string]$ModulePath=(Join-Path (Split-Path $PSScriptRoot -Parent) 'modUserMasterBridge.bas')
)

$ErrorActionPreference='Stop'
$productPath=(Resolve-Path -LiteralPath $ProductWorkbookPath).Path
$salesPath=(Resolve-Path -LiteralPath $SalesWorkbookPath).Path
$modulePath=(Resolve-Path -LiteralPath $ModulePath).Path
$workspace=Split-Path $productPath -Parent
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$productBackup=Join-Path $workspace "Product_Template.before_user_master_$stamp.xlsm"
$salesBackup=Join-Path $workspace "Sales_Template.before_user_master_$stamp.xlsm"

foreach($lock in @('~$Product_Template.xlsm','~$Sales_Template.xlsm')) {
    if(Test-Path -LiteralPath (Join-Path $workspace $lock)){throw "$lock exists. Close both workbooks first."}
}
Copy-Item -LiteralPath $productPath -Destination $productBackup
Copy-Item -LiteralPath $salesPath -Destination $salesBackup

function Install-UserMasterModule($Workbook,[string[]]$ObsoleteModules,[string]$EntityName) {
    foreach($moduleName in @($ObsoleteModules)+@('modUserMasterBridge')) {
        $existing=$null
        try{$existing=$Workbook.VBProject.VBComponents.Item($moduleName)}catch{}
        if($null -ne $existing){$Workbook.VBProject.VBComponents.Remove($existing)}
    }
    [void]$Workbook.VBProject.VBComponents.Import($modulePath)
    $excel.Run("'$($Workbook.Name)'!ConfigureUserMasterSheet",$EntityName)
}

$excel=$null
$workbook=$null
try {
    $excel=New-Object -ComObject Excel.Application
    $excel.Visible=$false
    $excel.DisplayAlerts=$false

    $workbook=$excel.Workbooks.Open($productPath,0,$false)
    if($workbook.ReadOnly){throw 'Product_Template.xlsm opened read-only.'}
    Install-UserMasterModule $workbook @('modProductBridge','modCustomerBridge') 'Product'
    $workbook.Save();$workbook.Close($false);$workbook=$null

    $workbook=$excel.Workbooks.Open($salesPath,0,$false)
    if($workbook.ReadOnly){throw 'Sales_Template.xlsm opened read-only.'}
    Install-UserMasterModule $workbook @('modCustomerBridge','modProductBridge') 'Customer'
    $workbook.Save();$workbook.Close($false);$workbook=$null

    "ProductBackup=$productBackup"
    "SalesBackup=$salesBackup"
    'PASS: shared User Master VBA installed in Product and Sales workbooks.'
}
finally {
    if($null -ne $workbook){$workbook.Close($false)}
    if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}
