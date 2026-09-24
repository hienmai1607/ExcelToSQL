param([Parameter(Mandatory=$true)][string]$WorkbookPath,[switch]$Refresh)
$ErrorActionPreference='Stop'
$excel=$null;$book=$null
try{
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false
 $book=$excel.Workbooks.Open((Resolve-Path -LiteralPath $WorkbookPath).Path,0,$false)
 # Inject the probe into a disposable generated workbook only; no network or data writes.
 $module=$book.VBProject.VBComponents.Item('modProductLocal').CodeModule
 $module.AddFromString(@'
Public Function TestClearedReadOnly() As String
 On Error GoTo Failed
 Dim original As Object
 Set original = JsonConverter.ParseJson(S(WS.Cells(3, FieldColumn("_Original")).Value2))
 original("WeightOz") = "3.53"
 WS.Cells(3, FieldColumn("_Original")).Value2 = JsonConverter.ConvertToJson(original)
 WS.Cells(3, FieldColumn("WeightOz")).ClearContents
 If Not Dirty() Then Err.Raise 5, , "Cleared values must count as unsaved changes"
 TestClearedReadOnly = "OK"
 Exit Function
Failed:
 TestClearedReadOnly = Err.Description
End Function
Public Function TestClearAndReload() As String
 On Error GoTo Failed
 Dim c As Long, rowsEnd As Long, delta As Object
 rowsEnd = LastRow()
 For c = 1 To LastFieldColumn()
  If Not WS.Columns(c).Hidden Then WS.Range(WS.Cells(3, c), WS.Cells(rowsEnd, c)).ClearContents
 Next c
 If Not Dirty() Then Err.Raise 5, , "Visible clear should prompt before discard"
 LoadPage 1
 If Dirty() Then Err.Raise 5, , "Visible clear did not reload cleanly"
 WS.Rows("3:" & LastRow()).ClearContents
 LoadPage 1
 If Len(S(WS.Cells(3, FieldColumn("_ID")).Value2)) = 0 Or Dirty() Then Err.Raise 5, , "Full row clear did not reload cleanly"
 WS.Cells(3, FieldColumn("WeightOz")).Value2 = "read-only test"
 On Error Resume Next
 Set delta = Changes(3, "U")
 Dim saveError As String: saveError = Err.Description
 On Error GoTo Failed
 If InStr(saveError, "read-only") = 0 Then Err.Raise 5, , "Save read-only validation must remain enabled"
 TestClearAndReload = "OK"
 Exit Function
Failed:
 TestClearAndReload = Err.Description
End Function
Public Function TestOriginalKey() As String
 On Error GoTo Failed
 TestOriginalKey = CStr(FieldColumn("_Original"))
 Exit Function
Failed:
 TestOriginalKey = Err.Description
End Function
Public Function TestRefreshMetadata() As String
 On Error GoTo Failed
 LoadPage 1
 If Len(S(WS.Cells(3, FieldColumn("_Original")).Value2)) = 0 Then Err.Raise 5, , "Original snapshot not loaded"
 If Len(S(WS.Cells(3, FieldColumn("_ID")).Value2)) = 0 Then Err.Raise 5, , "ID not loaded"
 If Len(S(WS.Cells(3, FieldColumn("_RowVersion")).Value2)) = 0 Then Err.Raise 5, , "RowVersion not loaded"
 If Dirty() Then Err.Raise 5, , "Freshly loaded records incorrectly marked dirty"
 TestRefreshMetadata = "OK"
 Exit Function
Failed:
 TestRefreshMetadata = Err.Description
End Function
'@)
 $ws=$book.Worksheets.Item('Product')
 if($ws.Cells.Item(1,2).Interior.Color -ne 0xF7EBDD){throw 'Editable Grade header must be blue'}
 if($ws.Cells.Item(1,3).Interior.Color -ne 0xCCF2FF){throw 'Required Product name header must be yellow'}
 if($ws.Cells.Item(1,18).Interior.Color -ne 0xE6E6E7){throw 'Display metadata header must be gray'}
 'PASS: required/editable/display header colors render in Excel.'
 if($ws.Cells.Item(2,18).Value2 -ne '_Original' -or -not $ws.Columns.Item(18).Hidden){throw 'Fixture must contain a hidden trailing _Original field.'}
 $actual=$excel.Run("'$($book.Name)'!TestOriginalKey")
 if($actual -notmatch '^\d+$'){throw "FAIL: $actual"}
 "PASS: _Original resolves to column $actual while hidden."
 $snapshot=$ws.Cells.Item(3,18).Value2
 $result=$excel.Run("'$($book.Name)'!TestClearedReadOnly")
 $ws.Cells.Item(3,18).Value2=$snapshot
 if($result -ne 'OK'){throw "FAIL: cleared cells: $result"}
 'PASS: cleared read-only fields are detected without blocking Refresh.'
 if($Refresh){
  for($i=0;$i -lt 2;$i++){
   $result=$excel.Run("'$($book.Name)'!TestRefreshMetadata")
   if($result -ne 'OK'){throw "FAIL: Refresh metadata: $result"}
  }
  'PASS: repeated live Refresh retains ID, RowVersion and original values without false dirty flags.'
  # Approve discard only inside this disposable test copy; production confirmation is unchanged.
  $confirmation=$book.VBProject.VBComponents.Item('modSaveConfirmation').CodeModule
  $start=$confirmation.ProcStartLine('ConfirmDiscardChanges',0)
  $count=$confirmation.ProcCountLines('ConfirmDiscardChanges',0)
  $confirmation.DeleteLines($start,$count)
  $confirmation.AddFromString("Public Function ConfirmDiscardChanges(ByVal entity As String) As Boolean"+[Environment]::NewLine+"ConfirmDiscardChanges = True"+[Environment]::NewLine+"End Function")
  $result=$excel.Run("'$($book.Name)'!TestClearAndReload")
  if($result -ne 'OK'){throw "FAIL: clear/reload: $result"}
  'PASS: visible-cell clear and full-row clear both reload; Save still rejects read-only edits.'
 }
}finally{
 if($null -ne $book){$book.Close($false)}
 if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}
