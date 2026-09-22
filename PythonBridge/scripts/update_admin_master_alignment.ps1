param(
    [string]$WorkbookPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'Admin_Master.xlsm'),
    [string]$ModulePath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'modAdminMasterBridge.bas')
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'workbook_backup.ps1')
$workbookFile = (Resolve-Path -LiteralPath $WorkbookPath).Path
$moduleFile = (Resolve-Path -LiteralPath $ModulePath).Path
$workspace = Split-Path $workbookFile -Parent
$backupFile=New-WorkbookBackup -WorkbookPath $workbookFile

$excel = $null
$workbook = $null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $workbook = $excel.Workbooks.Open($workbookFile)
    if ($workbook.ReadOnly) { throw 'Admin_Master.xlsm is open elsewhere. Close Excel and rerun.' }

    function Move-ReferenceColumns($sheet) {
        if ([string]$sheet.Range('B1').Value2 -ne 'ID') { return }
        $lastRow = $sheet.Cells.Item($sheet.Rows.Count, 1).End(-4162).Row
        for ($row = 2; $row -le $lastRow; $row++) {
            $id = $sheet.Cells.Item($row, 2).Value2
            $code = $sheet.Cells.Item($row, 3).Value2
            $name = $sheet.Cells.Item($row, 4).Value2
            $rowVersion = $sheet.Cells.Item($row, 5).Value2
            $status = $sheet.Cells.Item($row, 6).Value2
            $message = $sheet.Cells.Item($row, 7).Value2
            $sheet.Range("B$row").Value2 = [string]$code
            $sheet.Range("C$row").Value2 = [string]$name
            $sheet.Range("D$row").Value2 = [string]$status
            $sheet.Range("E$row").Value2 = [string]$message
            $sheet.Range("F$row").Value2 = [string]$id
            $sheet.Range("G$row").Value2 = [string]$rowVersion
        }
    }

    Move-ReferenceColumns $workbook.Worksheets.Item('Market')
    Move-ReferenceColumns $workbook.Worksheets.Item('Currency')

    foreach ($moduleName in @('modMarketBridge', 'modCurrencyBridge', 'modIdentityAdminBridge', 'modAdminMasterBridge')) {
        $existing = $null
        foreach ($component in $workbook.VBProject.VBComponents) {
            if ($component.Name -eq $moduleName) { $existing = $component; break }
        }
        if ($null -ne $existing) { $workbook.VBProject.VBComponents.Remove($existing) }
    }
    Install-SharedPagination $workbook
    [void]$workbook.VBProject.VBComponents.Import($moduleFile)
    $shared=$null
    try {$shared=$workbook.VBProject.VBComponents.Item('modSaveConfirmation')}catch{}
    if($null -ne $shared){$workbook.VBProject.VBComponents.Remove($shared)}
    [void]$workbook.VBProject.VBComponents.Import((Join-Path $workspace 'modSaveConfirmation.bas'))

    # Remove the obsolete generic confirmation implementation. The aligned
    # engine owns confirmation semantics because Users uses deactivation.
    $httpModule = $workbook.VBProject.VBComponents.Item('modHttpJson').CodeModule
    try {
        $startLine = $httpModule.ProcStartLine('ConfirmAdminMasterSave', 0)
        $lineCount = $httpModule.ProcCountLines('ConfirmAdminMasterSave', 0)
        $httpModule.DeleteLines($startLine, $lineCount)
    } catch [System.Runtime.InteropServices.COMException] {}

    foreach ($entity in @('Market', 'Currency', 'Users', 'User Access')) {
        $excel.Run("'$($workbook.Name)'!ConfigureAdminSheet", $entity)
        $sheet = $workbook.Worksheets.Item($entity)
        $sheet.Columns.Item('A').ColumnWidth = 12
        $sheet.Columns.Item('B').ColumnWidth = 20
        $sheet.Columns.Item('C').ColumnWidth = 30
        $sheet.Columns.Item('D').ColumnWidth = 12
        $sheet.Columns.Item('E').ColumnWidth = 45
    }

    function Normalize-Buttons($sheet, [string]$suffix, [string]$saveMacro, [string]$refreshMacro) {
        foreach ($shape in @($sheet.Shapes)) { $shape.Delete() }
        $saveCell = $sheet.Range('J1')
        $save = $sheet.Shapes.AddFormControl(0, $saveCell.Left, $saveCell.Top, 65, 22)
        $save.Name = "btnSave$suffix"; $save.TextFrame.Characters().Text = 'Save'
        $save.OnAction = "'$($workbook.Name)'!$saveMacro"
        $refreshCell = $sheet.Range('K1')
        $refresh = $sheet.Shapes.AddFormControl(0, $refreshCell.Left, $refreshCell.Top, 65, 22)
        $refresh.Name = "btnRefresh$suffix"; $refresh.TextFrame.Characters().Text = 'Refresh'
        $refresh.OnAction = "'$($workbook.Name)'!$refreshMacro"
    }

    Normalize-Buttons $workbook.Worksheets.Item('Market') 'Market' 'SaveMarketSheet' 'RefreshMarketSheet'
    Normalize-Buttons $workbook.Worksheets.Item('Currency') 'Currency' 'SaveCurrencySheet' 'RefreshCurrencySheet'
    Normalize-Buttons $workbook.Worksheets.Item('Users') 'Users' 'SaveUsersSheet' 'RefreshUsersSheet'
    Normalize-Buttons $workbook.Worksheets.Item('User Access') 'UserAccess' 'SaveUserAccessSheet' 'RefreshUserAccessSheet'

    function Assert-Confirmation([string]$entity, [string]$required, [string]$forbidden) {
        $sheet = $workbook.Worksheets.Item($entity)
        $saved = @($sheet.Range('A2:A4').Value2)
        $sheet.Range('A2').Value2 = 'C'; $sheet.Range('A3').Value2 = 'U'; $sheet.Range('A4').Value2 = 'D'
        $message = [string]$excel.Run("'$($workbook.Name)'!AdminConfirmationMessage", $sheet, $entity)
        for ($index = 0; $index -lt 3; $index++) { $sheet.Cells.Item($index + 2, 1).Value2 = $saved[$index] }
        if ($message -notlike "*$required*") { throw "$entity confirmation is missing '$required': $message" }
        if ($forbidden -and $message -like "*$forbidden*") { throw "$entity confirmation contains '$forbidden': $message" }
    }
    Assert-Confirmation 'Market' 'Delete: 1' ''
    Assert-Confirmation 'Users' 'Deactivate: 1' 'Delete is permanent.'

    $workbook.Save()
    "PASS: Admin Master workbook alignment"
    "Backup=$backupFile"
    "ModuleLines=$($workbook.VBProject.VBComponents.Item('modAdminMasterBridge').CodeModule.CountOfLines)"
}
finally {
    if ($null -ne $workbook) { $workbook.Close($false) }
    if ($null -ne $excel) { $excel.Quit() }
    if ($null -ne $workbook) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) }
    if ($null -ne $excel) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
