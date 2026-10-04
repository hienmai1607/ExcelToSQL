# Isolated VBA smoke test. Uses a temporary workbook; never writes database records.
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$templatePath=Join-Path $projectRoot 'templates\Packaging_Master_Local_Update.xlsm'
$excel=$null;$book=$null
try {
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false
 $book=$excel.Workbooks.Open($templatePath,0,$true)
 $module=$book.VBProject.VBComponents.Item('modPackagingMasterLocal').CodeModule
 $module.AddFromString(@'
Public Function TestPalletMaster() As String
 On Error GoTo Failed
 Dim keys As Variant, i As Long, d As Object, original As Object, message As String
 keys = Array("Command", "UnitOfMeasure", "Width", "Length", "PalletAreaMM2", "PalletSize", "Status", "_ID", "_RowVersion", "_Original")
 WS.Cells.Clear
 For i = 0 To UBound(keys)
  WS.Cells(1, i + 1).Value2 = keys(i)
  WS.Cells(2, i + 1).Value2 = keys(i)
 Next i
 Config.Range("B1").Value2 = "1"
 Config.Range("B6").Value2 = "pallets"
 Config.Range("B7").Value2 = "UnitOfMeasure|Width|Length|Status"
 Config.Range("B8").Value2 = "UnitOfMeasure|Width|Length"
 WS.Cells(3, FieldColumn("Command")).Value2 = "N"
 WS.Cells(3, FieldColumn("UnitOfMeasure")).Value2 = "M"
 WS.Cells(3, FieldColumn("Width")).Value2 = 1.1
 WS.Cells(3, FieldColumn("Length")).Value2 = 1.1
 WS.Cells(3, FieldColumn("PalletAreaMM2")).Value2 = 1210000
 WS.Cells(3, FieldColumn("PalletSize")).Value2 = "1.1x1.1M"
 WS.Cells(3, FieldColumn("Status")).Value2 = "Active"
 Set original = CurrentValues(3)
 original("Width") = "1.1000"
 original("Length") = "1.1000"
 original("PalletAreaMM2") = "1210000.00000000"
 WS.Cells(3, FieldColumn("_Original")).Value2 = JsonConverter.ConvertToJson(original)
 If Dirty() Then Err.Raise 5, , "Numeric dimensions incorrectly marked dirty"
 WS.Cells(3, FieldColumn("Width")).Value2 = 1.2345
 Set d = Changes(3, "U")
 If d.Count <> 1 Or d("Width") <> "1.2345" Then Err.Raise 5, , "Dimension edit not preserved"
 WS.Cells(3, FieldColumn("PalletSize")).Value2 = "Fake"
 On Error Resume Next
 Set d = Changes(3, "U")
 message = Err.Description
 Err.Clear
 On Error GoTo Failed
 If InStr(message, "read-only") = 0 Then Err.Raise 5, , "Calculated pallet size accepted"
 WS.Cells(3, FieldColumn("PalletSize")).Value2 = "1.1x1.1M"
 WS.Cells(3, FieldColumn("PalletAreaMM2")).Value2 = 99
 message = ""
 On Error Resume Next
 Set d = Changes(3, "U")
 message = Err.Description
 Err.Clear
 On Error GoTo Failed
 If InStr(message, "read-only") = 0 Then Err.Raise 5, , "Calculated pallet area accepted"
 TestPalletMaster = "OK"
 Exit Function
Failed:
 TestPalletMaster = Err.Description
End Function
'@)
 $result=$excel.Run("'$($book.Name)'!TestPalletMaster")
 if($result -ne 'OK'){throw "FAIL: $result"}
 'PASS: Pallet Excel numeric equality, four-decimal edits and calculated-field protection.'
} finally {
 if($null -ne $book){$book.Close($false)}
 if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}
