param([Parameter(Mandatory=$true)][string]$WorkbookPath)
$ErrorActionPreference='Stop'
$excel=$null;$book=$null
try{
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false
 $book=$excel.Workbooks.Open((Resolve-Path -LiteralPath $WorkbookPath).Path,0,$false)
 $module=$book.VBProject.VBComponents.Item('modPackagingRequestLocal').CodeModule
 $module.AddFromString(@'
Public Function TestPackagingWorkbook() As String
 On Error GoTo Failed
 If Dirty() Then Err.Raise 5, , "Fresh workbook unexpectedly dirty"
 If Not WS.Columns(FieldColumn("_Original")).Hidden Then Err.Raise 5, , "Metadata must be hidden"
 If WS.Cells(1, FieldColumn("RequestNumber")).Interior.Color <> RGB(221, 235, 247) Then Err.Raise 5, , "Header color"
 If WS.Cells(1, FieldColumn("FirstPMType")).Interior.Color <> RGB(244, 177, 131) Then Err.Raise 5, , "Required response color"
 LoadPage 1
 If Dirty() Then Err.Raise 5, , "Refreshed workbook unexpectedly dirty"
 Dim previous As Variant, d As Object, message As String
 previous = WS.Cells(3, FieldColumn("FirstPMType")).Value2
 WS.Cells(3, FieldColumn("FirstPMType")).Value2 = "Test bag"
 Set d = Changes(3, "U")
 If d("FirstPMType") <> "Test bag" Then Err.Raise 5, , "Response change not detected"
 WS.Cells(3, FieldColumn("FirstPMType")).Value2 = previous
 previous = WS.Cells(3, FieldColumn("ProductCode")).Value2
 WS.Cells(3, FieldColumn("ProductCode")).Value2 = "Read-only test"
 On Error Resume Next
 Set d = Changes(3, "U")
 message = Err.Description
 On Error GoTo Failed
 WS.Cells(3, FieldColumn("ProductCode")).Value2 = previous
 If InStr(message, "read-only") = 0 Then Err.Raise 5, , "Snapshot validation missing"
 WS.Rows("3:" & LastRow()).ClearContents
 LoadPage 1
 If Dirty() Then Err.Raise 5, , "Clear and Refresh did not restore original snapshots"
 TestPackagingWorkbook = "OK"
 Exit Function
Failed:
 TestPackagingWorkbook = Err.Description
End Function
'@)
 # Test copy only: permit discard without leaving a modal dialog.
 $confirmation=$book.VBProject.VBComponents.Item('modSaveConfirmation').CodeModule
 $start=$confirmation.ProcStartLine('ConfirmDiscardChanges',0)
 $count=$confirmation.ProcCountLines('ConfirmDiscardChanges',0)
 $confirmation.DeleteLines($start,$count)
 $confirmation.AddFromString("Public Function ConfirmDiscardChanges(ByVal entity As String) As Boolean"+[Environment]::NewLine+"ConfirmDiscardChanges = True"+[Environment]::NewLine+"End Function")
 $result=$excel.Run("'$($book.Name)'!TestPackagingWorkbook")
 if($result -ne 'OK'){throw "FAIL: $result"}
 'PASS: Packaging VBA compiles; live Refresh, colors, metadata, response changes, snapshot protection, and clear/refresh verified.'
}finally{
 if($null -ne $book){$book.Close($false)}
 if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}
