param([Parameter(Mandatory=$true)][string]$WorkbookPath)
$ErrorActionPreference='Stop'
$excel=$null;$book=$null
try{
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false
 $book=$excel.Workbooks.Open((Resolve-Path -LiteralPath $WorkbookPath).Path,0,$false)
 $module=$book.VBProject.VBComponents.Item('modPackagingMasterLocal').CodeModule
 $module.AddFromString(@'
Public Function TestPackagingMaster() As String
 On Error GoTo Failed
 If Dirty() Then Err.Raise 5, , "Downloaded workbook unexpectedly dirty"
 Dim key As Variant, d As Object, prior As Variant, message As String, c As Long
 For Each key In Split(S(Config.Range("B8").Value2), "|")
  If WS.Columns(FieldColumn(CStr(key))).Hidden Then Err.Raise 5, , "Required column hidden"
  If WS.Cells(1, FieldColumn(CStr(key))).Interior.Color <> RGB(255, 242, 204) Then Err.Raise 5, , "Required column color"
 Next key
 If Not WS.Columns(FieldColumn("_Original")).Hidden Then Err.Raise 5, , "Metadata visible"
 LoadPage 1
 If Dirty() Then Err.Raise 5, , "Refreshed workbook unexpectedly dirty"
 If S(Config.Range("B6").Value2) = "prices" Then
  prior = WS.Cells(3, FieldColumn("EffectiveFrom")).Value2
  WS.Cells(3, FieldColumn("EffectiveFrom")).Value2 = CDbl(DateSerial(2026, 9, 19))
  Set d = CurrentValues(3)
  If d("EffectiveFrom") <> "2026-09-19" Then Err.Raise 5, , "Date serial not converted to ISO"
  WS.Cells(3, FieldColumn("EffectiveFrom")).Value2 = prior
  If ISODate(CDbl(DateSerial(2026, 9, 19))) <> "2026-09-19" Then Err.Raise 5, , "Date filter conversion"
 End If
 c = FieldColumn("CreatedByName"): prior = WS.Cells(3, c).Value2
 WS.Cells(3, c).Value2 = "Read-only test"
 On Error Resume Next
 Set d = Changes(3, "U")
 message = Err.Description
 On Error GoTo Failed
 WS.Cells(3, c).Value2 = prior
 If InStr(message, "read-only") = 0 Then Err.Raise 5, , "Read-only audit field accepted"
 PackagingMasterNew
 If S(WS.Cells(LastRow(), FieldColumn("Command")).Value2) <> "C" Then Err.Raise 5, , "New record command missing"
 If S(Config.Range("B6").Value2) = "prices" Then
  If S(WS.Cells(LastRow(), FieldColumn("QuantityFrom")).Value2) <> "0" Then Err.Raise 5, , "QuantityFrom default missing"
 End If
 WS.Rows("3:" & LastRow()).ClearContents
 LoadPage 1
 If Dirty() Then Err.Raise 5, , "Clear/Refresh did not restore a clean page"
 TestPackagingMaster = "OK"
 Exit Function
Failed:
 TestPackagingMaster = Err.Description
End Function
'@)
 $confirmation=$book.VBProject.VBComponents.Item('modSaveConfirmation').CodeModule
 $start=$confirmation.ProcStartLine('ConfirmDiscardChanges',0);$count=$confirmation.ProcCountLines('ConfirmDiscardChanges',0)
 $confirmation.DeleteLines($start,$count)
 $confirmation.AddFromString("Public Function ConfirmDiscardChanges(ByVal entity As String) As Boolean"+[Environment]::NewLine+"ConfirmDiscardChanges = True"+[Environment]::NewLine+"End Function")
 $result=$excel.Run("'$($book.Name)'!TestPackagingMaster")
 if($result -ne 'OK'){throw "FAIL: $result"}
 'PASS: Packaging master VBA, required colors, hidden metadata, Refresh, dates, audit protection and New record.'
}finally{
 if($null -ne $book){$book.Close($false)}
 if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}
