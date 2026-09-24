param([Parameter(Mandatory=$true)][string]$WorkbookPath)
$ErrorActionPreference='Stop'
$excel=$null;$book=$null
try{
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false
 $book=$excel.Workbooks.Open((Resolve-Path -LiteralPath $WorkbookPath).Path,0,$false)
 $module=$book.VBProject.VBComponents.Item('modOpportunityLocal').CodeModule
 $module.AddFromString(@'
Public Function TestOpportunityWorkbook() As String
 On Error GoTo Failed
 If Dirty() Then Err.Raise 5, , "Fresh workbook unexpectedly dirty"
 If Not WS.Columns(FieldColumn("_Original")).Hidden Then Err.Raise 5, , "Metadata not hidden"
 If WS.Cells(1, FieldColumn("CustomerName")).Interior.Color <> RGB(189, 215, 238) Then Err.Raise 5, , "Header color"
 If WS.Cells(1, FieldColumn("ProductCode")).Interior.Color <> RGB(244, 177, 131) Then Err.Raise 5, , "Item color"
 LoadPage 1
 If Dirty() Then Err.Raise 5, , "Refreshed workbook unexpectedly dirty"
 Dim d As Object, originalDate As Variant
 originalDate = WS.Cells(3, FieldColumn("BidOpen")).Value2
 WS.Cells(3, FieldColumn("BidOpen")).Value2 = CDbl(DateSerial(2026, 9, 19))
 Set d = Changes(3, "Header")
 If d("BidOpen") <> "2026-09-19" Then Err.Raise 5, , "Date serial not ISO"
 WS.Cells(3, FieldColumn("BidOpen")).Value2 = originalDate
 WS.Activate
 WS.Cells(3, 1).Select
 OpportunityAddItem
 If Command(LastRow(), "Item") <> "C" Then Err.Raise 5, , "Add Item did not create command"
 If WS.Cells(LastRow(), FieldColumn("_OpportunityID")).Value2 <> WS.Cells(3, FieldColumn("_OpportunityID")).Value2 Then Err.Raise 5, , "New item lost header ID"
 WS.Rows(LastRow()).ClearContents
 OpportunityNew
 If Command(LastRow(), "Header") <> "C" Or Command(LastRow(), "Item") <> "C" Then Err.Raise 5, , "New commands"
 WS.Rows(LastRow()).ClearContents
 LoadPage 1
 If Dirty() Then Err.Raise 5, , "Final Refresh dirty"
 TestOpportunityWorkbook = "OK"
 Exit Function
Failed:
 TestOpportunityWorkbook = Err.Description
End Function
'@)
 $result=$excel.Run("'$($book.Name)'!TestOpportunityWorkbook")
 if($result -ne 'OK'){throw "FAIL: $result"}
 'PASS: Opportunity VBA compiles; live Refresh, metadata, colors, ISO dates, Add Item and New Opportunity verified.'
} finally {
 if($null -ne $book){$book.Close($false)}
 if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}
