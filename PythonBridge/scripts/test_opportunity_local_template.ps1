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
 If WS.Cells(3, FieldColumn("CustomerName")).Interior.ColorIndex = xlColorIndexNone Then Err.Raise 5, , "Group field color missing"
 If WS.Rows(5).RowHeight > 20 Then Err.Raise 5, , "Data row is oversized"
 If WS.Cells(5, FieldColumn("_Original")).WrapText Then Err.Raise 5, , "Hidden metadata must not wrap"
 If WS.Cells(3, FieldColumn("ProductCode")).Interior.ColorIndex = xlColorIndexNone Then Err.Raise 5, , "Subgroup field color missing"
 LoadPage 1
 If Dirty() Then Err.Raise 5, , "Refreshed workbook unexpectedly dirty"
 Dim d As Object, originalDate As Variant
 If WS.Cells(4, FieldColumn("AnnualUnit")).Interior.Color <> RGB(198, 239, 206) Then Err.Raise 5, , "Editable legend color"
 If Not WS.Cells(1, FieldColumn("FreightUSDPerContainer")).MergeCells Then Err.Raise 5, , "Section merge missing"
 Dim before As Object
 Set before = Original(5)
 If before.Exists("HasOpenPackagingRequest") Then
  If before("HasOpenPackagingRequest") = True Then
   If CanEdit("ContainerRequest", "Item", before) Or CanEdit("ConfigurationRequest", "Item", before) Then Err.Raise 5, , "Processing requirements are editable"
   If Not CanEdit("FreightUSDPerContainer", "Item", before) Then Err.Raise 5, , "Processing costs are locked"
   If WS.Cells(5, FieldColumn("ContainerRequest")).Interior.ColorIndex <> xlColorIndexNone Then Err.Raise 5, , "Processing requirement color"
   If WS.Cells(5, FieldColumn("FreightUSDPerContainer")).Interior.ColorIndex <> xlColorIndexNone Then Err.Raise 5, , "Processing cost color"
  End If
 End If
 Dim rr As Long, childBefore As Object, dutyCell As Range
 For rr = 5 To LastRow()
  Set childBefore = Original(rr)
  If childBefore.Exists("ParentItemID") Then
   If Len(S(childBefore("ParentItemID"))) > 0 Then
    Set dutyCell = WS.Cells(rr, FieldColumn("DutyPct"))
    If Not dutyCell.Font.Italic Then Err.Raise 5, , "Inherited Duty formatting missing"
    If InStr(dutyCell.Validation.InputMessage, "Inherited from Mix parent. Edit row ") = 0 Then Err.Raise 5, , "Inherited Duty parent guidance missing"
    dutyCell.Value2 = "2"
    On Error Resume Next
    Set d = Changes(rr, "Item")
    Dim lockMessage As String: lockMessage = Err.Description
    Err.Clear: On Error GoTo Failed
    dutyCell.Value2 = S(childBefore("DutyPct"))
    If InStr(lockMessage, "Inherited from Mix parent. Edit row ") = 0 Then Err.Raise 5, , "Save error omits parent guidance"
    Exit For
   End If
  End If
 Next rr
 If WS.Rows(2).Hidden Or WS.Rows(3).Hidden Then Err.Raise 5, , "Header row visibility"
 If Config.Cells(10, FieldColumn("ProductCode")).Value2 <> "ProductCode" Then Err.Raise 5, , "Configuration keys"
 If WS.AutoFilter.Range.Row <> 4 Then Err.Raise 5, , "Filter row"
 If WS.Rows(5).RowHeight <> 18 Then Err.Raise 5, , "Refresh data height"
 If WS.Cells(5, FieldColumn("_Original")).WrapText Then Err.Raise 5, , "Refresh metadata wraps"
 If WS.Cells(5, FieldColumn("FreightUSDPerContainer")).Borders(xlEdgeBottom).LineStyle <> xlContinuous Then Err.Raise 5, , "Data border missing"

 originalDate = WS.Cells(5, FieldColumn("BidOpen")).Value2
 WS.Cells(5, FieldColumn("BidOpen")).Value2 = CDbl(DateSerial(2026, 9, 19))
 Set d = Changes(5, "Header")
 If d("BidOpen") <> "2026-09-19" Then Err.Raise 5, , "Date serial not ISO"
 WS.Cells(5, FieldColumn("BidOpen")).Value2 = originalDate
 WS.Activate
 WS.Cells(5, 1).Select
 OpportunityAddItem
 If WS.Rows(LastRow()).RowHeight <> 18 Then Err.Raise 5, , "Add Item height"
 If WS.Cells(LastRow(), FieldColumn("ItemCommand")).Interior.ColorIndex <> xlColorIndexNone Then Err.Raise 5, , "Add Item fill"
 If Command(LastRow(), "Item") <> "C" Then Err.Raise 5, , "Add Item did not create command"
 If WS.Cells(LastRow(), FieldColumn("_OpportunityID")).Value2 <> WS.Cells(5, FieldColumn("_OpportunityID")).Value2 Then Err.Raise 5, , "New item lost header ID"
 WS.Rows(LastRow()).ClearContents
 OpportunityNew
 If WS.Rows(LastRow()).RowHeight <> 18 Then Err.Raise 5, , "New Opportunity height"
 If WS.Cells(LastRow(), FieldColumn("ItemCommand")).Interior.ColorIndex <> xlColorIndexNone Then Err.Raise 5, , "New Opportunity fill"
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
