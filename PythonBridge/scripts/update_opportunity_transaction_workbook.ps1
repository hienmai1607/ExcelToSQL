param(
    [string]$SalesWorkbookPath=(Join-Path (Split-Path $PSScriptRoot -Parent) 'Sales_Template.xlsm')
)

$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'workbook_backup.ps1')
$root=Split-Path $PSScriptRoot -Parent
$salesPath=(Resolve-Path -LiteralPath $SalesWorkbookPath).Path
$opportunityModule=(Resolve-Path -LiteralPath (Join-Path $root 'modUnifiedOpportunityBridge.bas')).Path
$userModule=(Resolve-Path -LiteralPath (Join-Path $root 'modUserMasterBridge.bas')).Path
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'

if(Test-Path -LiteralPath (Join-Path $root '~$Sales_Template.xlsm')) {
    throw 'Sales_Template.xlsm is open. Close it before migration.'
}
$backup=New-WorkbookBackup -WorkbookPath $salesPath

function Install-Module($Workbook,[string]$Name,[string]$Path) {
    $existing=$null
    try {$existing=$Workbook.VBProject.VBComponents.Item($Name)} catch {}
    if($null -ne $existing) {$Workbook.VBProject.VBComponents.Remove($existing)}
    [void]$Workbook.VBProject.VBComponents.Import($Path)
}

function Add-Button($Workbook,$Sheet,[string]$Name,[string]$Caption,[string]$Cell,[string]$Macro) {
    $existing=$null
    try {$existing=$Sheet.Shapes.Item($Name)} catch {}
    if($null -ne $existing) {$existing.Delete()}
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
    $workbook=$excel.Workbooks.Open($salesPath,0,$false)
    if($workbook.ReadOnly) {throw 'Sales_Template.xlsm opened read-only.'}

    Install-SharedPagination $workbook
    Install-Module $workbook 'modUserMasterBridge' $userModule
    Install-Module $workbook 'modSaveConfirmation' (Join-Path $root 'modSaveConfirmation.bas')
    Install-Module $workbook 'modUnifiedOpportunityBridge' $opportunityModule
    $excel.Run("'$($workbook.Name)'!ConfigureUserMasterSheet",'Customer')
    $excel.Run("'$($workbook.Name)'!ConfigureUnifiedOpportunity")

    $sheet=$workbook.Worksheets.Item('Opportunity')
    $sheet.Unprotect()
    Add-Button $workbook $sheet 'btnPreviousOpportunity' 'Previous' 'Z2' 'PreviousOpportunityPage'
    Add-Button $workbook $sheet 'btnNextOpportunity' 'Next' 'AA2' 'NextOpportunityPage'
    $workbook.Worksheets.Item('_Lookups').Visible=2

    $workbook.Save()
    $workbook.Close($false)
    $workbook=$null
    "Backup=$backup"
    'PASS: Opportunity transaction workbook model installed.'
}
finally {
    if($null -ne $workbook) {$workbook.Close($false)}
    if($null -ne $excel) {$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}
