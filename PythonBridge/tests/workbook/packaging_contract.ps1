param([string]$WorkbookPath=(Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'Packaging_Template.xlsm'))
$ErrorActionPreference='Stop'
$excel=$null
$book=$null
try {
    $excel=New-Object -ComObject Excel.Application
    $excel.Visible=$false
    $excel.DisplayAlerts=$false
    $excel.EnableEvents=$false
    $book=$excel.Workbooks.Open((Resolve-Path -LiteralPath $WorkbookPath).Path,0,$true)
    $isoDate=$excel.Run("'$($book.Name)'!DateToIsoString",46284)
    if ([string]$isoDate -ne '2026-09-19') { throw ('Excel serial date was not converted to ISO: '+$isoDate) }
    Write-Output 'PASS: Excel serial dates are serialized as ISO yyyy-mm-dd'
    foreach ($name in @('Packaging Request','Packaging Material','Packaging Price','Packaging History','Manual Request')) {
        $sheet=$book.Worksheets.Item($name)
        if ($sheet.ListObjects.Item(1).HeaderRowRange.Row -ne 1) { throw ($name+': headers not on row 1.') }
        if ($sheet.Range('BB4').Value2 -ne 200) { throw ($name+': default is not 200.') }
        if ($sheet.ProtectContents) { throw ($name+': sheet unexpectedly protected.') }
        foreach ($button in @('pkgSave','pkgRefresh','pkgPrevious','pkgNext')) {
            if (-not $sheet.Shapes.Item($button).OnAction) { throw ($name+': unwired button '+$button) }
        }
        Write-Output ('PASS: '+$name+' headers, controls, page size, no protection')
    }
    $module=$book.VBProject.VBComponents.Add(1)
    $module.Name='PackagingContract'
    $module.CodeModule.AddFromString(@'
Option Explicit
Public Function VerifyPackagingRender() As String
    On Error GoTo Failed
    Dim checkpoint As String: checkpoint = "render two rows"
    Dim ws As Worksheet: Set ws = ThisWorkbook.Worksheets("Packaging Request")
    Dim rows As New Collection, item As Object
    Set item = CreateObject("Scripting.Dictionary")
    item.Add "ItemID", 101: item.Add "ProductCode", "Z": item.Add "ItemRowVersion", "version101"
    item.Add "ProductName", "=1+1"
    item.Add "Cost", Null
    rows.Add item
    Set item = CreateObject("Scripting.Dictionary")
    item.Add "ItemID", 202: item.Add "ProductCode", "A": item.Add "ItemRowVersion", "version202"
    rows.Add item
    RenderPage ws, rows
    Dim table As ListObject: Set table = ws.ListObjects(1)
    If table.ListRows.Count <> 2 Then Err.Raise 5, , "Wrong rendered row count"
    If table.ListColumns("Product Name").DataBodyRange.Cells(1, 1).HasFormula Then Err.Raise 5, , "Text became an Excel formula"
    If Len(table.ListColumns("Cost").DataBodyRange.Cells(1, 1).Value2 & "") <> 0 Then Err.Raise 5, , "NULL cost became zero"
    table.Sort.SortFields.Clear
    table.Sort.SortFields.Add Key:=table.ListColumns("Product Code").Range, SortOn:=xlSortOnValues, Order:=xlAscending
    table.Sort.Header = xlYes
    table.Sort.Apply
    If CStr(table.ListColumns("Request Item ID").DataBodyRange.Cells(1, 1).Value2) <> "202" Then Err.Raise 5, , "Sorting detached ID"
    If table.ListColumns("Item RowVersion").DataBodyRange.Cells(1, 1).Value2 <> "version202" Then Err.Raise 5, , "Sorting detached RowVersion"
    If Not table.ListColumns("Request Item ID").Range.EntireColumn.Hidden Then Err.Raise 5, , "Technical ID visible"
    ws.Range("BB4").Value2 = 500
    If PackagingPageSize(ws) <> 500 Then Err.Raise 5, , "Page size 500 rejected"
    ws.Range("BB4").Value2 = 0
    Dim failed As Boolean
    On Error Resume Next
    Dim size As Long: size = PackagingPageSize(ws)
    failed = (Err.Number <> 0): Err.Clear
    On Error GoTo Failed
    If Not failed Then Err.Raise 5, , "Invalid page size accepted"
    Dim emptyRows As New Collection
    checkpoint = "render empty page"
    RenderPage ws, emptyRows
    If table.HeaderRowRange.Row <> 1 Or table.ListRows.Count <> 1 Then Err.Raise 5, , "Empty page corrupted table"
    VerifyPackagingRender = "PASS: VBA render, NULL values, text safety, hidden IDs/RowVersions after sort, page size bounds and empty page."
    Exit Function
Failed:
    VerifyPackagingRender = "FAIL: " & checkpoint & ": " & Err.Number & " " & Err.Description
End Function
'@)
    $result=$excel.Run("'$($book.Name)'!VerifyPackagingRender")
    Write-Output $result
    if ($result -notlike 'PASS:*') { throw $result }
}
finally {
    if ($null -ne $book) { $book.Close($false) }
    if ($null -ne $excel) { $excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
}
