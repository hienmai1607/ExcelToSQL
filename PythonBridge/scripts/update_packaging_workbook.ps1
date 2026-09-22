param(
    [string]$WorkbookPath=(Join-Path (Split-Path $PSScriptRoot -Parent) 'Packaging_Template.xlsm')
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'workbook_backup.ps1')
$workspace=Split-Path $PSScriptRoot -Parent
$path=(Resolve-Path -LiteralPath $WorkbookPath).Path
if (Test-Path -LiteralPath (Join-Path (Split-Path $path -Parent) '~$Packaging_Template.xlsm')) {
    throw 'Close Packaging_Template.xlsm before updating.'
}
$backup=New-WorkbookBackup -WorkbookPath $path
$excel=$null
$book=$null
try {
    $excel=New-Object -ComObject Excel.Application
    $excel.Visible=$false
    $excel.DisplayAlerts=$false
    $excel.EnableEvents=$false
    $book=$excel.Workbooks.Open($path,0,$false)
    if ($book.ReadOnly) { throw 'Workbook opened read-only.' }
    foreach ($name in @('JsonConverter','modHttpJson','modSaveConfirmation','modPagination','modPackagingBridge')) {
        $old=$null
        try { $old=$book.VBProject.VBComponents.Item($name) } catch {}
        if ($null -ne $old) { $book.VBProject.VBComponents.Remove($old) }
        [void]$book.VBProject.VBComponents.Import((Join-Path $workspace ($name+'.bas')))
    }
    $scripting=$false
    foreach ($reference in $book.VBProject.References) {
        if ($reference.GUID -eq '{420B2830-E718-11CF-893D-00A0C9054228}') { $scripting=$true }
    }
    if (-not $scripting) { [void]$book.VBProject.References.AddFromGuid('{420B2830-E718-11CF-893D-00A0C9054228}',1,0) }
    foreach ($sheetName in @('Packaging Request','Packaging Material','Packaging Price','Packaging History','Manual Request')) {
        $sheet=$null
        try { $sheet=$book.Worksheets.Item($sheetName) } catch {}
        if ($null -eq $sheet) {
            $sheet=$book.Worksheets.Add([Type]::Missing,$book.Worksheets.Item($book.Worksheets.Count))
            $sheet.Name=$sheetName
        }
        $headers=$excel.Run("'$($book.Name)'!PackagingHeaders",$sheetName)
        if ($sheet.ListObjects.Count -gt 0) {
            $table=$sheet.ListObjects.Item(1)
            if ($table.HeaderRowRange.Row -eq 4) { $sheet.Rows.Item('1:3').Delete() }
            if ($table.HeaderRowRange.Row -ne 1) { throw ($sheetName+': unexpected table header row.') }
            if ($table.ListColumns.Count -ne $headers.Count) { throw ($sheetName+': unexpected schema. No data discarded.') }
            if ($excel.WorksheetFunction.CountA($table.DataBodyRange) -eq 0) {
                $table.Resize($sheet.Range($sheet.Cells.Item(1,1),$sheet.Cells.Item(201,$headers.Count)))
            }
        } else {
            for ($i=0;$i -lt $headers.Count;$i++) { $sheet.Cells.Item(1,$i+1).Value2=$headers[$i] }
            $table=$sheet.ListObjects.Add(1,$sheet.Range($sheet.Cells.Item(1,1),$sheet.Cells.Item(201,$headers.Count)),[Type]::Missing,1)
            $table.Name='tbl'+$sheetName.Replace(' ','')
        }
        $table.TableStyle='TableStyleMedium2'
        $table.ShowAutoFilter=$true
        $table.HeaderRowRange.WrapText=$true
        $table.HeaderRowRange.RowHeight=36
        $table.Range.ColumnWidth=18
        $table.Range.EntireColumn.Hidden=$false
        for ($i=0;$i -lt $headers.Count;$i++) {
            if ($table.ListColumns.Item($i+1).Name -ne $headers[$i]) { throw ($sheetName+': header mismatch.') }
            $column=$table.ListColumns.Item($i+1).Range.EntireColumn
            $column.NumberFormat='@'
            if ($headers[$i] -match '\(mm\)|^Cost$|^Unit Price$|^Quantity (From|To)$') { $column.NumberFormat='0.0000' }
            elseif ($headers[$i] -match '^Annual Units$') { $column.NumberFormat='0' }
            elseif ($headers[$i] -match '^Bid (Open|Close)$|^Response Due$|^Effective (From|To)$') { $column.NumberFormat='yyyy-mm-dd' }
        }
        $hiddenStart=$excel.Run("'$($book.Name)'!PackagingHiddenStart",$sheetName)
        $sheet.Range($sheet.Columns.Item($hiddenStart),$sheet.Columns.Item($headers.Count)).EntireColumn.Hidden=$true
        $sheet.Range($sheet.Columns.Item($headers.Count+1),$sheet.Columns.Item(52)).EntireColumn.Hidden=$true
        if ($sheetName -ne 'Packaging History') {
            $commandRange=$table.ListColumns.Item('Command').DataBodyRange
            $commandRange.Validation.Delete()
            $choices=switch ($sheetName) { 'Packaging Request' {'N,U'} 'Manual Request' {'N,C'} default {'N,C,U,D'} }
            $commandRange.Validation.Add(3,1,1,$choices)
            $commandRange.Validation.IgnoreBlank=$true
            $commandRange.Validation.InCellDropdown=$true
        }
        # Controls stay outside every table, so table filters/sorts cannot move them.
        foreach ($buttonName in @('pkgSave','pkgRefresh','pkgPrevious','pkgNext')) {
            try { $sheet.Shapes.Item($buttonName).Delete() } catch {}
        }
        $buttons=@(
            @{Name='pkgSave';Text='Save';Macro='PackagingSave';Cell='BA1'},
            @{Name='pkgRefresh';Text='Refresh';Macro='PackagingRefresh';Cell='BB1'},
            @{Name='pkgPrevious';Text='Previous';Macro='PackagingPrevious';Cell='BC1'},
            @{Name='pkgNext';Text='Next';Macro='PackagingNext';Cell='BD1'}
        )
        foreach ($definition in $buttons) {
            $anchor=$sheet.Range($definition.Cell)
            $button=$sheet.Buttons().Add($anchor.Left,$anchor.Top,82,25)
            $button.Name=$definition.Name
            $button.Caption=$definition.Text
            $button.OnAction="'$($book.Name)'!"+$definition.Macro
            $button.Placement=3
        }
        $sheet.Range('BA:BD').ColumnWidth=17
        $sheet.Range('BA4').Value2='Rows per page'
        if ([string]::IsNullOrWhiteSpace([string]$sheet.Range('BB4').Value2)) { $sheet.Range('BB4').Value2=200 }
        $sheet.Range('BB4').NumberFormat='0'
        $sheet.Range('BB4').Interior.Color=13434879
        $sheet.Range('BB4').Validation.Delete()
        $sheet.Range('BB4').Validation.Add(1,1,1,1,500)
        $sheet.Range('BB4').Validation.IgnoreBlank=$false
        $sheet.Range('BA5').Value2='Page'
        $sheet.Range('BB5').Value2=1
        $sheet.Range('BB5').NumberFormat='0'
        $sheet.Range('BA6').Value2='Total matching'
        $sheet.Range('BA7').Value2='Rows loaded'
        $sheet.Range('BA8').Value2=if ($sheetName -eq 'Packaging Material') { 'Code/name prefix' } elseif ($sheetName -eq 'Packaging Price') { 'No search filter' } else { 'Opportunity prefix' }
        $sheet.Range('BB8').NumberFormat='@'
        $sheet.Range('BB8').Interior.Color=13434879
        $sheet.Range('BA10').Value2='Save includes filtered-out commands.'
        $sheet.Range('BA11').Value2='Save/discard changes before paging.'
        $sheet.Range('BD5').NumberFormat=';;;'
        $sheet.Range('BD5').ClearContents()
        $sheet.Activate()
        $excel.ActiveWindow.FreezePanes=$false
        $excel.ActiveWindow.SplitRow=1
        $excel.ActiveWindow.SplitColumn=2
        $excel.ActiveWindow.FreezePanes=$true
    }
    $guide=$book.Worksheets.Item('Read Me')
    $guide.Cells.ClearContents()
    $notes=@(
        'PACKAGING WORKBOOK - SQL/API INTEGRATION',
        'Data tables start on row 1. Save, Refresh, Previous and Next are at BA1:BD1.',
        'BB4 = rows per page (1-500, default 200). BB5 = page. BB8 = optional prefix filter where shown.',
        'Refresh after changing page size or filter. Save or explicitly discard pending commands before changing pages.',
        'Packaging Material / Price: C=create, U=update, D=block, N=no change. Packaging or Admin scope required.',
        'Packaging Request: U saves assigned PIC responses, or any eligible response for Admin. Editable stage required.',
        'Packaging History is an approved-record reference view, not a separate history table. Save makes no changes there.',
        'Manual Request: Refresh existing Draft Opportunities; mark selected rows C; fill Response Due on every selected row.',
        'Use the same Response Due and Request Notes on selected rows of one Opportunity. Packaging Requirement is per item.',
        'Manual Save creates one request per selected Opportunity, with only its selected lines. Opportunity or Admin scope required.',
        'Manual Request does not create/change Opportunity records. Create Opportunities in Sales_Template first.',
        'Technical IDs, source RowVersions and retry keys are hidden and move with complete Excel Table rows.',
        'Creation keys are saved to this workbook before POST. After a network failure retry Save without changing the selected payload.',
        'Response Submit, PIC assignment and Manager Review use the API/app workflow interfaces, not Excel stage edits.',
        'Typing another PIC or stage in Excel is ignored by Save. Blank response numbers stay NULL; zero is a real value.',
        'Use full-table sorting/filtering; never sort or copy only part of a record. Save includes commands hidden by filters.',
        'API requires core/packaging_api.py and SQL migrations 13-16 in the existing test database. Restart the API after deployment.',
        'The environment variable PYTHON_BRIDGE_URL controls the API address; workbook authentication uses the shared bridge settings.'
    )
    for ($i=0;$i -lt $notes.Count;$i++) { $guide.Cells.Item($i+1,1).Value2=$notes[$i] }
    $guide.Columns.Item(1).ColumnWidth=115
    $guide.UsedRange.WrapText=$true
    $guide.UsedRange.Rows.AutoFit() | Out-Null
    $book.Worksheets.Item('Manual Request').Activate()
    # Running an exported function forces VBA compile/load before saving.
    $size=$excel.Run("'$($book.Name)'!PackagingPageSize",$book.Worksheets.Item('Manual Request'))
    if ($size -ne 200) { throw 'Manual Request default page size is not 200.' }
    $book.Save()
    $book.Close($false)
    $book=$null
    Write-Output ('Updated: '+$path)
    Write-Output ('Backup: '+$backup)
}
finally {
    if ($null -ne $book) { $book.Close($false) }
    if ($null -ne $excel) { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
}
