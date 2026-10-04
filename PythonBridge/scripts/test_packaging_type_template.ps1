# Isolated VBA smoke test; no database writes and no template modifications saved.
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$excel=$null;$book=$null
try {
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false
 $book=$excel.Workbooks.Open((Join-Path $projectRoot 'templates\Packaging_Master_Local_Update.xlsm'),0,$true)
 $module=$book.VBProject.VBComponents.Item('modPackagingMasterLocal').CodeModule
 $module.AddFromString(@'
Public Function TestPackagingTypeMaster() As String
 On Error GoTo Failed
 Dim keys As Variant, i As Long, d As Object, original As Object, message As String
 keys = Array("Command", "ParentType", "PackagingOrder", "PackagingType", "PriceBasis", "Status", "CreatedByName", "_ID", "_RowVersion", "_Original")
 WS.Cells.Clear
 For i = 0 To UBound(keys)
  WS.Cells(1, i + 1).Value2 = keys(i)
  WS.Cells(2, i + 1).Value2 = keys(i)
 Next i
 Config.Range("B1").Value2 = "1"
 Config.Range("B6").Value2 = "packaging-types"
 Config.Range("B7").Value2 = "ParentType|PackagingOrder|PackagingType|PriceBasis|Status"
 Config.Range("B8").Value2 = "PackagingOrder|PackagingType|PriceBasis"
 WS.Cells(3, FieldColumn("Command")).Value2 = "N"
 WS.Cells(3, FieldColumn("PackagingOrder")).Value2 = "Primary"
 WS.Cells(3, FieldColumn("PackagingType")).Value2 = "Pouch"
 WS.Cells(3, FieldColumn("PriceBasis")).Value2 = "Count"
 WS.Cells(3, FieldColumn("Status")).Value2 = "Active"
 WS.Cells(3, FieldColumn("CreatedByName")).Value2 = "Tester"
 Set original = CurrentValues(3)
 WS.Cells(3, FieldColumn("_Original")).Value2 = JsonConverter.ConvertToJson(original)
 If Dirty() Then Err.Raise 5, , "Unchanged type incorrectly marked dirty"
 WS.Cells(3, FieldColumn("ParentType")).Value2 = "Secondary / Group"
 Set d = Changes(3, "U")
 If d.Count <> 1 Or d("ParentType") <> "Secondary / Group" Then Err.Raise 5, , "Parent type edit not preserved"
 WS.Cells(3, FieldColumn("PackagingOrder")).Value2 = "Secondary"
 WS.Cells(3, FieldColumn("PriceBasis")).Value2 = "Square meter"
 Set d = Changes(3, "U")
 If d("PackagingOrder") <> "Secondary" Or d("PriceBasis") <> "Square meter" Then Err.Raise 5, , "Choice edit not preserved"
 WS.Cells(3, FieldColumn("CreatedByName")).Value2 = "Fake"
 On Error Resume Next
 Set d = Changes(3, "U")
 message = Err.Description
 Err.Clear
 On Error GoTo Failed
 If InStr(message, "read-only") = 0 Then Err.Raise 5, , "Audit edit accepted"
 TestPackagingTypeMaster = "OK"
 Exit Function
Failed:
 TestPackagingTypeMaster = Err.Description
End Function
'@)
 $result=$excel.Run("'$($book.Name)'!TestPackagingTypeMaster")
 if($result -ne 'OK'){throw "FAIL: $result"}
 'PASS: Packaging Type Excel choices, parent type edits and audit protection without tare weight.'
} finally {
 if($null -ne $book){$book.Close($false)}
 if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}
