Attribute VB_Name = "modOpportunityLocal"
Option Explicit
Private busy As Boolean

Private Function WS() As Worksheet
    Set WS = ThisWorkbook.Worksheets("Opportunity")
End Function
Private Function Config() As Worksheet
    Set Config = ThisWorkbook.Worksheets("_Config")
End Function
Private Function Controls() As Worksheet
    Set Controls = ThisWorkbook.Worksheets("Controls")
End Function
Private Function LastFieldColumn() As Long
    Dim f As Range
    ' End(xlToLeft) skips hidden columns. Formula search includes hidden metadata.
    Set f = WS.Rows(2).Find(What:="*", After:=WS.Cells(2, 1), LookIn:=xlFormulas, _
        LookAt:=xlPart, SearchOrder:=xlByColumns, SearchDirection:=xlPrevious, _
        MatchCase:=False, SearchFormat:=False)
    If f Is Nothing Then Err.Raise vbObjectError + 3112, , "Field keys are missing. Download a fresh workbook."
    LastFieldColumn = f.Column
End Function
Private Function FieldColumn(ByVal key As String) As Long
    Dim c As Long
    For c = 1 To LastFieldColumn()
        If StrComp(S(WS.Cells(2, c).Value2), key, vbBinaryCompare) = 0 Then FieldColumn = c: Exit Function
    Next c
    Err.Raise vbObjectError + 3100, , "Missing field key: " & key & ". Download a fresh workbook."
End Function
Private Function LastRow() As Long
    Dim f As Range
    Set f = WS.Cells.Find(What:="*", LookIn:=xlFormulas, LookAt:=xlPart, _
        SearchOrder:=xlByRows, SearchDirection:=xlPrevious, MatchCase:=False, SearchFormat:=False)
    LastRow = 2
    If Not f Is Nothing Then LastRow = Application.Max(2, f.Row)
End Function
Private Function S(ByVal v As Variant) As String
    If Not IsNull(v) And Not IsEmpty(v) Then S = CStr(v)
End Function
Private Function Editable(ByVal key As String, ByVal level As String) As Boolean
    Dim allowed As String
    allowed = S(Config.Range(IIf(level = "Header", "B6", "B7")).Value2)
    Editable = InStr(1, "|" & allowed & "|", "|" & key & "|", vbBinaryCompare) > 0
End Function
Private Function Api(ByVal endpoint As String, ByVal body As Object) As Object
    Dim http As Object, base As String
    If S(Config.Range("B1").Value2) <> "1" Then Err.Raise vbObjectError + 3110, , "Unsupported workbook version. Download a fresh workbook."
    base = S(Config.Range("B2").Value2)
    If Left$(base, 7) <> "http://" And Left$(base, 8) <> "https://" Then Err.Raise vbObjectError + 3101, , "Invalid API URL."
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
    http.SetTimeouts 5000, 5000, 15000, 120000
    http.SetAutoLogonPolicy 0
    http.Option(6) = False
    http.Open "POST", base & "/api/workbench/opportunity-excel/" & endpoint, False
    http.SetRequestHeader "Content-Type", "application/json"
    http.SetRequestHeader "X-User-Name", Environ$("USERNAME")
    http.Send JsonConverter.ConvertToJson(body)
    If http.Status <> 200 Then Err.Raise vbObjectError + 3102, , "API error (" & http.Status & "): " & http.ResponseText
    If http.GetResponseHeader("X-Bridge-Contract") <> "2" Then Err.Raise vbObjectError + 3111, , "Excel/API version mismatch."
    Set Api = JsonConverter.ParseJson(http.ResponseText)
End Function
Private Function Command(ByVal r As Long, ByVal level As String) As String
    Command = UCase$(Trim$(S(WS.Cells(r, FieldColumn(level & "Command")).Value2)))
    If Command = "" Then Command = "N"
    If InStr("|N|C|U|D|", "|" & Command & "|") = 0 Then Err.Raise 5, , "Invalid " & level & " command at row " & r
End Function
Private Function Original(ByVal r As Long) As Object
    Set Original = CreateObject("Scripting.Dictionary")
    If Len(S(WS.Cells(r, FieldColumn("_Original")).Value2)) > 0 Then Set Original = JsonConverter.ParseJson(S(WS.Cells(r, FieldColumn("_Original")).Value2))
End Function
Private Function CellValue(ByVal r As Long, ByVal c As Long) As Variant
    Dim key As String, v As Variant
    key = S(WS.Cells(2, c).Value2): v = WS.Cells(r, c).Value2
    If Len(S(v)) = 0 Then
        CellValue = Null
    ElseIf key = "BidOpen" Or key = "BidClose" Then
        If IsNumeric(v) Then
            CellValue = Format$(CDate(CDbl(v)), "yyyy-mm-dd")
        ElseIf IsDate(v) Then
            CellValue = Format$(CDate(v), "yyyy-mm-dd")
        Else
            CellValue = v
        End If
    Else
        CellValue = v
    End If
End Function
Private Function SameValue(ByVal a As Variant, ByVal b As Variant, ByVal key As String) As Boolean
    If Len(S(a)) = 0 And Len(S(b)) = 0 Then SameValue = True: Exit Function
    If InStr("|AnnualUnit|MixUnitQuantity|EstPctAwarded|ShelfPrice|ExchangeRateToVND|ExchangeRateVNDPerUSD|ExchangeRateCustomerCurrencyPerUSD|MaxPalletHeightM|ShelfLifeDays|", "|" & key & "|") > 0 Then
        If IsNumeric(a) And IsNumeric(b) Then SameValue = (CDbl(a) = CDbl(b)): Exit Function
    End If
    SameValue = (StrComp(S(a), S(b), vbBinaryCompare) = 0)
End Function
Private Function Changes(ByVal r As Long, ByVal level As String, Optional ByVal validate As Boolean = True) As Object
    Dim d As Object, before As Object, c As Long, key As String, old As Variant, value As Variant
    Dim cmd As String, start As Long, finish As Long
    Set d = CreateObject("Scripting.Dictionary"): Set before = Original(r)
    cmd = Command(r, level)
    If level = "Header" Then
        start = FieldColumn("HeaderCommand") + 1: finish = FieldColumn("ItemCommand") - 1
    Else
        start = FieldColumn("ItemCommand") + 1: finish = FieldColumn("_Result") - 1
    End If
    For c = start To finish
        key = S(WS.Cells(2, c).Value2): value = CellValue(r, c): old = Null
        If before.Exists(key) Then old = before(key)
        If cmd = "C" Then
            If Editable(key, level) And Not IsNull(value) Then d(key) = value
        ElseIf Not SameValue(value, old, key) Then
            If level = "Item" And before.Exists("ParentItemID") Then
                If Len(S(before("ParentItemID"))) > 0 And InStr("|ProductCode|ItemDescription|AnnualUnit|EstPctAwarded|ShelfPrice|PalletSize|PalletStacking|MaxPalletHeightM|ContainerRequest|", "|" & key & "|") > 0 Then
                    If validate Then Err.Raise 5, , "Row " & r & ": Mix child Product info and Annual units are display only; Pallet and Container requirements belong to the parent."
                End If
            End If
            If key = "OpportunityNumber" And Len(S(WS.Cells(r, FieldColumn("_OpportunityID")).Value2)) = 0 Then
                ' New group keys link unsaved header/item rows.
            Else
                If validate And Not Editable(key, level) Then Err.Raise 5, , "Row " & r & ": " & key & " is display only."
                d(key) = value
            End If
        End If
    Next c
    Set Changes = d
End Function
Private Function Dirty() As Boolean
    On Error GoTo InvalidEdit
    Dim r As Long, level As Variant, d As Object
    If S(Config.Range("B4").Value2) = "1" Then Dirty = True: Exit Function
    For r = 3 To LastRow()
        For Each level In Array("Header", "Item")
            If Command(r, CStr(level)) <> "N" Then Dirty = True: Exit Function
            Set d = Changes(r, CStr(level), False)
            If d.Count > 0 Then Dirty = True: Exit Function
        Next level
    Next r
    Exit Function
InvalidEdit:
    Dirty = True
End Function
Private Sub PutRow(ByVal r As Long, ByVal data As Object)
    Dim c As Long, key As String
    WS.Range(WS.Cells(r, 1), WS.Cells(r, LastFieldColumn())).ClearContents
    For c = 1 To LastFieldColumn()
        key = S(WS.Cells(2, c).Value2): WS.Cells(r, c).NumberFormat = "@"
        If data.Exists(key) Then
            If Not IsNull(data(key)) Then WS.Cells(r, c).Value2 = S(data(key))
        End If
    Next c
End Sub
Private Sub LoadPage(ByVal target As Long)
    Dim body As Object, header As Object, values As Object, response As Object, row As Variant
    Dim size As Variant, r As Long, key As Variant
    size = Controls.Range("B7").Value2
    If Not IsNumeric(size) Then Err.Raise 5, , "Opportunities per page must be a whole number from 1 to 500."
    If CDbl(size) <> Fix(CDbl(size)) Or CDbl(size) < 1 Or CDbl(size) > 500 Then Err.Raise 5, , "Opportunities per page must be a whole number from 1 to 500."
    If Dirty() Then
        If Not ConfirmDiscardChanges("Opportunity") Then Exit Sub
    End If
    Set body = JsonConverter.ParseJson(S(Config.Range("B3").Value2))
    body("page") = target: body("page_size") = CLng(size)
    Set header = body("views")("header")
    Set values = CreateObject("Scripting.Dictionary")
    values("opportunity_number") = S(Controls.Range("B3").Value2)
    values("customer_name") = S(Controls.Range("B4").Value2)
    values("stage") = S(Controls.Range("B5").Value2)
    values("bid_open_from") = S(Controls.Range("B9").Value2)
    values("bid_open_to") = S(Controls.Range("B10").Value2)
    Set header("values") = values
    Set response = Api("page", body)
    If LastRow() >= 3 Then WS.Range(WS.Cells(3, 1), WS.Cells(LastRow(), LastFieldColumn())).ClearContents
    r = 3
    For Each row In response("rows")
        PutRow r, row: r = r + 1
    Next row
    Controls.Range("B6").Value2 = target: Config.Range("B5").Value2 = target
    Controls.Range("B8").Value2 = response("total"): Config.Range("B4").Value2 = "0"
    WS.Rows(2).Hidden = True
    For Each key In Array("_OpportunityID", "_ItemID", "_HeaderVersion", "_ItemVersion", "_Original")
        WS.Columns(FieldColumn(CStr(key))).Hidden = True
    Next key
    ShowRequiredColumns
End Sub
Private Sub ShowRequiredColumns()
    Dim key As Variant
    For Each key In Split(S(Config.Range("B8").Value2), "|")
        WS.Columns(FieldColumn(CStr(key))).Hidden = False
    Next key
End Sub
Public Sub OpportunityRefresh()
    If busy Then Exit Sub
    On Error GoTo Failed
    busy = True
    ShowRequiredColumns
    Dim p As Variant: p = Controls.Range("B6").Value2
    If Not IsNumeric(p) Then Err.Raise vbObjectError + 3106, , "Page must be a positive whole number."
    If CDbl(p) < 1 Or CDbl(p) <> Fix(CDbl(p)) Then Err.Raise vbObjectError + 3106, , "Page must be a positive whole number."
    LoadPage CLng(p)
Done:
    Controls.Range("B6").Value2 = Config.Range("B5").Value2
    busy = False
    Exit Sub
Failed:
    MsgBox Err.Description, vbExclamation, "Opportunity": Resume Done
End Sub
Public Sub OpportunityFilter()
    Controls.Range("B6").Value2 = 1
    OpportunityRefresh
End Sub
Public Sub OpportunityNext()
    If Val(S(Controls.Range("B6").Value2)) * Val(S(Controls.Range("B7").Value2)) >= Val(S(Controls.Range("B8").Value2)) Then Exit Sub
    Controls.Range("B6").Value2 = Val(S(Controls.Range("B6").Value2)) + 1
    OpportunityRefresh
End Sub
Public Sub OpportunityPrevious()
    Controls.Range("B6").Value2 = Application.Max(1, Val(S(Controls.Range("B6").Value2)) - 1)
    OpportunityRefresh
End Sub
Public Sub OpportunityNew()
    If busy Then Exit Sub
    On Error GoTo Failed
    ShowRequiredColumns
    Dim r As Long: r = LastRow() + 1
    WS.Cells(r, FieldColumn("HeaderCommand")).Value2 = "C"
    WS.Cells(r, FieldColumn("ItemCommand")).Value2 = "C"
    WS.Cells(r, FieldColumn("OpportunityNumber")).Value2 = "XL-" & Format$(Now, "yymmddhhnnss") & "-" & r
    WS.Activate: WS.Cells(r, FieldColumn("CustomerName")).Select
    Exit Sub
Failed:
    MsgBox Err.Description, vbExclamation, "Opportunity"
End Sub
Public Sub OpportunityAddItem()
    If busy Then Exit Sub
    On Error GoTo Failed
    If ActiveSheet.Name <> "Opportunity" Or ActiveCell.Row < 3 Then Err.Raise 5, , "Select a source Opportunity row first."
    Dim source As Long, r As Long, c As Long, originalRow As Object, key As Variant, snapshot As Object
    source = ActiveCell.Row: r = LastRow() + 1
    If Len(S(WS.Cells(source, FieldColumn("OpportunityNumber")).Value2)) = 0 Then Err.Raise 5, , "Select a populated Opportunity row."
    ShowRequiredColumns
    For c = FieldColumn("HeaderCommand") + 1 To FieldColumn("ItemCommand") - 1
        WS.Cells(r, c).NumberFormat = "@": WS.Cells(r, c).Value2 = WS.Cells(source, c).Value2
    Next c
    For Each key In Array("_OpportunityID", "_HeaderVersion")
        WS.Cells(r, FieldColumn(CStr(key))).NumberFormat = "@"
        WS.Cells(r, FieldColumn(CStr(key))).Value2 = WS.Cells(source, FieldColumn(CStr(key))).Value2
    Next key
    Set originalRow = Original(source): Set snapshot = CreateObject("Scripting.Dictionary")
    For c = FieldColumn("HeaderCommand") + 1 To FieldColumn("ItemCommand") - 1
        key = S(WS.Cells(2, c).Value2)
        If originalRow.Exists(key) Then snapshot(key) = originalRow(key)
    Next c
    WS.Cells(r, FieldColumn("_Original")).Value2 = JsonConverter.ConvertToJson(snapshot)
    WS.Cells(r, FieldColumn("HeaderCommand")).Value2 = IIf(Len(S(WS.Cells(r, FieldColumn("_OpportunityID")).Value2)) = 0, "C", "N")
    WS.Cells(r, FieldColumn("ItemCommand")).Value2 = "C"
    WS.Cells(r, FieldColumn("ProductCode")).Select
    Exit Sub
Failed:
    MsgBox Err.Description, vbExclamation, "Opportunity"
End Sub
Public Sub OpportunitySave()
    If busy Then Exit Sub
    On Error GoTo Failed
    busy = True: ShowRequiredColumns
    If S(Config.Range("B4").Value2) = "1" Then Err.Raise 5, , "Previous Save outcome is unknown. Refresh and reconcile before saving again."
    Dim rows As New Collection, body As Object, entry As Object, h As Object, i As Object, response As Object, result As Variant
    Dim r As Long, key As Variant, value As Variant, creates As Long, updates As Long, deletes As Long, hc As String, ic As String
    For r = 3 To LastRow()
        If Len(S(WS.Cells(r, FieldColumn("OpportunityNumber")).Value2)) > 0 Then
            Set entry = CreateObject("Scripting.Dictionary")
            hc = Command(r, "Header"): ic = Command(r, "Item")
            Set h = Changes(r, "Header"): Set i = Changes(r, "Item")
            entry("row") = r: entry("number") = S(WS.Cells(r, FieldColumn("OpportunityNumber")).Value2)
            entry("header_command") = hc: entry("item_command") = ic
            For Each key In Array("opportunity_id", "item_id", "header_version", "item_version")
                Select Case key
                    Case "opportunity_id": value = WS.Cells(r, FieldColumn("_OpportunityID")).Value2
                    Case "item_id": value = WS.Cells(r, FieldColumn("_ItemID")).Value2
                    Case "header_version": value = WS.Cells(r, FieldColumn("_HeaderVersion")).Value2
                    Case "item_version": value = WS.Cells(r, FieldColumn("_ItemVersion")).Value2
                End Select
                If Len(S(value)) > 0 Then entry(key) = value
            Next key
            Set entry("header_changes") = h: Set entry("item_changes") = i
            rows.Add entry
            If hc = "C" Or ic = "C" Then creates = creates + 1
            If hc = "D" Or ic = "D" Then deletes = deletes + 1
            If (h.Count > 0 Or i.Count > 0 Or hc = "U" Or ic = "U") And hc <> "C" And ic <> "C" Then updates = updates + 1
        ElseIf Application.CountA(WS.Range(WS.Cells(r, 1), WS.Cells(r, LastFieldColumn()))) > 0 Then
            Err.Raise 5, , "Row " & r & ": Opportunity number / new group key is required."
        End If
    Next r
    If creates + updates + deletes = 0 Then MsgBox "No changes to save.", vbInformation: GoTo Done
    If Not ConfirmSaveMessage(BuildSaveConfirmation("Opportunity rows (header/item combined)", creates, updates, deletes, "Delete")) Then GoTo Done
    Set body = CreateObject("Scripting.Dictionary"): Set body("rows") = rows
    Config.Range("B4").Value2 = "1": ThisWorkbook.Save
    Set response = Api("save", body)
    For Each result In response("results")
        r = CLng(result("row"))
        If result("status") = "OK" Then
            If IsNull(result("values")) Then
                WS.Range(WS.Cells(r, 1), WS.Cells(r, LastFieldColumn())).ClearContents
            Else
                PutRow r, result("values")
            End If
        End If
        ' VBA does not short circuit Or: do not read values on an error result.
        If result("status") = "OK" Then
            If Not IsNull(result("values")) Then
                WS.Cells(r, FieldColumn("_Result")).Value2 = result("status")
                WS.Cells(r, FieldColumn("_Message")).NumberFormat = "@"
                WS.Cells(r, FieldColumn("_Message")).Value2 = result("message")
            End If
        Else
            WS.Cells(r, FieldColumn("_Result")).Value2 = result("status")
            WS.Cells(r, FieldColumn("_Message")).NumberFormat = "@"
            WS.Cells(r, FieldColumn("_Message")).Value2 = result("message")
        End If
    Next result
    Config.Range("B4").Value2 = "0": ThisWorkbook.Save
    MsgBox "Save completed. Review Result and Message; failed documents retain your entries.", vbInformation, "Opportunity"
Done:
    busy = False: Exit Sub
Failed:
    MsgBox Err.Description & vbCrLf & "Your entries are retained.", vbExclamation, "Opportunity": Resume Done
End Sub
