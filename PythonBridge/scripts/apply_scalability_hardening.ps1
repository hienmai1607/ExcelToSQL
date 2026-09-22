param(
    [string]$AdminWorkbookPath=(Join-Path (Split-Path $PSScriptRoot -Parent) 'Admin_Master.xlsm'),
    [string]$ProductWorkbookPath=(Join-Path (Split-Path $PSScriptRoot -Parent) 'Product_Template.xlsm'),
    [string]$SalesWorkbookPath=(Join-Path (Split-Path $PSScriptRoot -Parent) 'Sales_Template.xlsm')
)

$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'workbook_backup.ps1')
$root=Split-Path $PSScriptRoot -Parent
$adminPath=(Resolve-Path -LiteralPath $AdminWorkbookPath).Path
$productPath=(Resolve-Path -LiteralPath $ProductWorkbookPath).Path
$salesPath=(Resolve-Path -LiteralPath $SalesWorkbookPath).Path
$httpModule=(Resolve-Path -LiteralPath (Join-Path $root 'modHttpJson.bas')).Path
$userModule=(Resolve-Path -LiteralPath (Join-Path $root 'modUserMasterBridge.bas')).Path
$opportunityModule=(Resolve-Path -LiteralPath (Join-Path $root 'modUnifiedOpportunityBridge.bas')).Path
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'

foreach($name in @('Admin_Master.xlsm','Product_Template.xlsm','Sales_Template.xlsm')) {
    if(Test-Path -LiteralPath (Join-Path $root ('~$'+$name))){throw "$name is open. Close it before migration."}
}
$backups=@{}
$backups.Admin=New-WorkbookBackup -WorkbookPath $adminPath
$backups.Product=New-WorkbookBackup -WorkbookPath $productPath
$backups.Sales=New-WorkbookBackup -WorkbookPath $salesPath

function Install-Module($Workbook,[string]$Name,[string]$Path) {
    if($Name -eq 'modHttpJson'){Install-SharedPagination $Workbook}
    $existing=$null
    try{$existing=$Workbook.VBProject.VBComponents.Item($Name)}catch{}
    if($null -ne $existing){$Workbook.VBProject.VBComponents.Remove($existing)}
    [void]$Workbook.VBProject.VBComponents.Import($Path)
}

function Add-PagingButton($Workbook,$Sheet,[string]$Name,[string]$Caption,[string]$Cell,[string]$Macro) {
    $existing=$null
    try{$existing=$Sheet.Shapes.Item($Name)}catch{}
    if($null -ne $existing){$existing.Delete()}
    $anchor=$Sheet.Range($Cell)
    $button=$Sheet.Shapes.AddFormControl(0,$anchor.Left,$anchor.Top,70,22)
    $button.Name=$Name
    $button.TextFrame.Characters().Text=$Caption
    $button.OnAction="'$($Workbook.Name)'!$Macro"
}

$excel=$null
$workbook=$null
try {
    $excel=New-Object -ComObject Excel.Application
    $excel.Visible=$false
    $excel.DisplayAlerts=$false

    $workbook=$excel.Workbooks.Open($adminPath,0,$false)
    if($workbook.ReadOnly){throw 'Admin_Master.xlsm opened read-only.'}
    Install-Module $workbook 'modHttpJson' $httpModule
    $workbook.Save();$workbook.Close($false);$workbook=$null

    $workbook=$excel.Workbooks.Open($productPath,0,$false)
    if($workbook.ReadOnly){throw 'Product_Template.xlsm opened read-only.'}
    $sheet=$workbook.Worksheets.Item('Product')
    if([string]$sheet.Range('F1').Value2 -eq 'Result Status') {
        $lastRow=$sheet.Cells.Item($sheet.Rows.Count,1).End(-4162).Row
        for($row=2;$row -le $lastRow;$row++) {
            $oldResult=$sheet.Cells.Item($row,6).Value2
            $oldMessage=$sheet.Cells.Item($row,7).Value2
            $oldID=$sheet.Cells.Item($row,8).Value2
            $oldRowVersion=$sheet.Cells.Item($row,9).Value2
            $sheet.Cells.Item($row,6).Value2='Active'
            $sheet.Cells.Item($row,7).Value2=$oldResult
            $sheet.Cells.Item($row,8).Value2=$oldMessage
            $sheet.Cells.Item($row,9).Value2=$oldID
            $sheet.Cells.Item($row,10).Value2=$oldRowVersion
        }
    }
    Install-Module $workbook 'modHttpJson' $httpModule
    Install-Module $workbook 'modUserMasterBridge' $userModule
    $excel.Run("'$($workbook.Name)'!ConfigureUserMasterSheet",'Product')
    $labels=@('Filter Product Code','Filter Product Name','Page','Loaded','Total')
    for($index=0;$index -lt $labels.Count;$index++){$sheet.Cells.Item($index+2,13).Value2=$labels[$index]}
    Add-PagingButton $workbook $sheet 'btnPreviousProduct' 'Previous' 'P2' 'PreviousProductPage'
    Add-PagingButton $workbook $sheet 'btnNextProduct' 'Next' 'Q2' 'NextProductPage'
    $workbook.Save();$workbook.Close($false);$workbook=$null

    $workbook=$excel.Workbooks.Open($salesPath,0,$false)
    if($workbook.ReadOnly){throw 'Sales_Template.xlsm opened read-only.'}
    Install-Module $workbook 'modHttpJson' $httpModule
    Install-Module $workbook 'modUserMasterBridge' $userModule
    Install-Module $workbook 'modUnifiedOpportunityBridge' $opportunityModule
    $excel.Run("'$($workbook.Name)'!ConfigureUserMasterSheet",'Customer')
    $excel.Run("'$($workbook.Name)'!ConfigureUnifiedOpportunity")
    $sheet=$workbook.Worksheets.Item('Customer')
    $labels=@('Filter Customer Name','Filter Market Code','Filter Status','Page','Loaded','Total')
    for($index=0;$index -lt $labels.Count;$index++){$sheet.Cells.Item($index+2,12).Value2=$labels[$index]}
    Add-PagingButton $workbook $sheet 'btnPreviousCustomer' 'Previous' 'O2' 'PreviousCustomerPage'
    Add-PagingButton $workbook $sheet 'btnNextCustomer' 'Next' 'P2' 'NextCustomerPage'
    $workbook.Worksheets.Item('_Lookups').Visible=2
    $workbook.Save();$workbook.Close($false);$workbook=$null

    "AdminBackup=$($backups.Admin)"
    "ProductBackup=$($backups.Product)"
    "SalesBackup=$($backups.Sales)"
    'PASS: scalability hardening installed in all workbooks.'
}
finally {
    if($null -ne $workbook){$workbook.Close($false)}
    if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}
