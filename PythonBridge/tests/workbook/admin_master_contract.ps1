param(
    [string]$WorkbookPath = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'Admin_Master.xlsm')
)

$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $workbook = $excel.Workbooks.Open((Resolve-Path -LiteralPath $WorkbookPath).Path, 0, $true)

    $expected = @{
        'Market' = @('Command','Market Code','Market Name','Result Status','Message','ID','RowVersion')
        'Currency' = @('Command','Currency Code','Currency Name','Result Status','Message','ID','RowVersion')
        'Users' = @('Command','User Name','Is Active','Result Status','Message','ID','RowVersion')
        'User Access' = @('Command','User Name','Scope','Result Status','Message','Access ID','User ID','RowVersion')
    }
    foreach ($entity in $expected.Keys) {
        $sheet = $workbook.Worksheets.Item($entity)
        $headers = $expected[$entity]
        for ($column = 1; $column -le $headers.Count; $column++) {
            $actual = [string]$sheet.Cells.Item(1, $column).Value2
            if ($actual -ne $headers[$column - 1]) { throw "$entity column $column expected '$($headers[$column - 1])', got '$actual'." }
        }
        if (-not $sheet.Columns.Item(6).Hidden) { throw "$entity ID column must be hidden." }
        if (-not $sheet.Columns.Item($headers.Count).Hidden) { throw "$entity RowVersion column must be hidden." }
        if ($sheet.Range('A2').Validation.Formula1 -ne 'C,U,D,N') { throw "$entity Command validation is inconsistent." }
    }

    [void]$workbook.VBProject.VBComponents.Item('modAdminMasterBridge')
    $moduleNames = @($workbook.VBProject.VBComponents | ForEach-Object { $_.Name })
    foreach ($obsolete in @('modMarketBridge','modCurrencyBridge','modIdentityAdminBridge')) {
        if ($moduleNames -contains $obsolete) { throw "Obsolete module remains: $obsolete" }
    }

    foreach ($case in @(
        @('Market','Delete: 1','Delete is permanent.'),
        @('Users','Deactivate: 1','')
    )) {
        $sheet = $workbook.Worksheets.Item($case[0])
        $saved = @($sheet.Range('A2:A4').Value2)
        $sheet.Range('A2').Value2='C'; $sheet.Range('A3').Value2='U'; $sheet.Range('A4').Value2='D'
        $message = [string]$excel.Run("'$($workbook.Name)'!AdminConfirmationMessage", $sheet, $case[0])
        if ($message -notlike "*$($case[1])*") { throw "$($case[0]) confirmation message is incorrect: $message" }
        if ($case[2] -and $message -notlike "*$($case[2])*") { throw "$($case[0]) permanent-delete warning is missing." }
        if ($case[0] -eq 'Users' -and $message -like '*Delete is permanent.*') { throw 'Users confirmation incorrectly describes deactivation as permanent deletion.' }
        for ($index=0; $index -lt 3; $index++) { $sheet.Cells.Item($index+2,1).Value2=$saved[$index] }
    }

    'PASS: Admin Master workbook contract'
}
finally {
    if ($null -ne $workbook) { $workbook.Close($false) }
    if ($null -ne $excel) { $excel.Quit() }
    if ($null -ne $workbook) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) }
    if ($null -ne $excel) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
