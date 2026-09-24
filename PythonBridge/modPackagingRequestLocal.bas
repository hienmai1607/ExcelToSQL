Attribute VB_Name = "modPackagingRequestLocal"
Option Explicit
Private busy As Boolean

Private Function WS() As Worksheet
    Set WS = ThisWorkbook.Worksheets("Packaging Request")
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
Private Function Editable(ByVal key As String) As Boolean
    Editable = InStr(1, "|" & S(Config.Range("B6").Value2) & "|", "|" & key & "|", vbBinaryCompare) > 0
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
    http.Open "POST", base & "/api/workbench/packaging-excel/" & endpoint, False
    http.SetRequestHeader "Content-Type", "application/json"
    http.SetRequestHeader "X-User-Name", Environ$("USERNAME")
    http.Send JsonConverter.ConvertToJson(body)
    If http.Status <> 200 Then Err.Raise vbObjectError + 3102, , "API error (" & http.Status & "): " & http.ResponseText
    If http.GetResponseHeader("X-Bridge-Contract") <> "2" Then Err.Raise vbObjectError + 3111, , "Excel/API version mismatch."
    Set Api = JsonConverter.ParseJson(http.ResponseText)
End Function
Private Function CurrentValues(ByVal r As Long, Optional ByVal validate As Boolean = True) As Object
    Dim d As Object, c As Long, key As String, v As Variant
    Set d = CreateObject("Scripting.Dictionary")
    For c = 1 To LastFieldColumn()
        key = S(WS.Cells(2, c).Value2)
        If key <> "ItemCommand" And key <> "EditAccess" And Left$(key, 1) <> "_" And Len(key) > 0 Then
            v = WS.Cells(r, c).Value2
            If Len(S(v)) = 0 Then v = Null
            If validate And Not IsNull(v) And NumericField(key) Then
                If Not IsNumeric(v) Then Err.Raise vbObjectError + 3103, , "Row " & r & ": invalid numeric value for " & key
                v = CStr(v)
            End If
            d(key) = v
        End If
    Next c
    Set CurrentValues = d
End Function
Private Function NumericField(ByVal key As String) As Boolean
    NumericField = InStr("|HeightMM|WidthMM|LengthMM|PMCost|UnitsPerCarton|FirstPMMOQ|SecondPMMOQ|CartonsPerLayer|LayersPerPallet|PacksPerPallet|CartonsPerContainer|", "|" & key & "|") > 0
End Function
Private Function SameValue(ByVal a As Variant, ByVal b As Variant, ByVal key As String) As Boolean
    If Len(S(a)) = 0 And Len(S(b)) = 0 Then SameValue = True: Exit Function
    If NumericField(key) Then
        If IsNumeric(a) And IsNumeric(b) Then SameValue = (CDec(a) = CDec(b)): Exit Function
    End If
    SameValue = (StrComp(S(a), S(b), vbBinaryCompare) = 0)
End Function
Private Function Changes(ByVal r As Long, ByVal command As String, Optional ByVal validate As Boolean = True) As Object
    Dim d As Object, current As Object, original As Object, key As Variant, before As Variant
    Set d = CreateObject("Scripting.Dictionary")
    Set current = CurrentValues(r, validate)
    Set original = CreateObject("Scripting.Dictionary")
    If Len(S(WS.Cells(r, FieldColumn("_Original")).Value2)) > 0 Then Set original = JsonConverter.ParseJson(S(WS.Cells(r, FieldColumn("_Original")).Value2))
    For Each key In current.Keys
        before = Null
        If original.Exists(key) Then before = original(key)
        If command = "C" Then
            If Editable(CStr(key)) And Not IsNull(current(key)) Then d(key) = current(key)
        ElseIf Not SameValue(current(key), before, CStr(key)) Then
            If validate And Not Editable(CStr(key)) Then Err.Raise vbObjectError + 3104, , "Row " & r & ": " & key & " is read-only. Undo the edit."
            d(key) = current(key)
        End If
    Next key
    Set Changes = d
End Function
Private Function Dirty() As Boolean
    ' Refresh detects edits; only Save validates their business meaning.
    On Error GoTo UnreadableEdit
    Dim r As Long, cmd As String, d As Object
    If S(Config.Range("B4").Value2) = "1" Then Dirty = True: Exit Function
    For r = 3 To LastRow()
        cmd = UCase$(Trim$(S(WS.Cells(r, FieldColumn("ItemCommand")).Value2)))
        If cmd <> "" And cmd <> "N" Then Dirty = True: Exit Function
        Set d = Changes(r, "U", False)
        If d.Count > 0 Then Dirty = True: Exit Function
    Next r
    Exit Function
UnreadableEdit:
    ' Invalid cells or damaged original values may still be discarded safely.
    Dirty = True
End Function
Private Sub LoadPage(ByVal target As Long)
    Dim body As Object, header As Object, filters As Object, response As Object, row As Variant, key As Variant
    Dim size As Variant, r As Long, c As Long
    size = Controls.Range("B7").Value2
    If Not IsNumeric(size) Then Err.Raise 5, , "Requests per page must be a whole number from 1 to 500."
    If CDbl(size) <> Fix(CDbl(size)) Or CDbl(size) < 1 Or CDbl(size) > 500 Then Err.Raise 5, , "Requests per page must be a whole number from 1 to 500."
    If Dirty() Then
        If Not ConfirmDiscardChanges("Packaging Request") Then Exit Sub
    End If
    Set body = JsonConverter.ParseJson(S(Config.Range("B3").Value2))
    body("page") = target: body("page_size") = CLng(size)
    Set header = body("views")("header")
    Set filters = CreateObject("Scripting.Dictionary")
    filters("search") = S(Controls.Range("B3").Value2)
    filters("status") = S(Controls.Range("B4").Value2)
    Set header("values") = filters
    Set response = Api("page", body)
    If LastRow() >= 3 Then WS.Range(WS.Cells(3, 1), WS.Cells(LastRow(), LastFieldColumn())).ClearContents
    r = 3
    For Each row In response("rows")
        For c = 1 To LastFieldColumn()
            key = S(WS.Cells(2, c).Value2): WS.Cells(r, c).NumberFormat = "@"
            If row.Exists(key) Then
                If Not IsNull(row(key)) Then WS.Cells(r, c).Value2 = S(row(key))
            End If
        Next c
        r = r + 1
    Next row
    Controls.Range("B6").Value2 = target: Config.Range("B5").Value2 = target
    Controls.Range("B8").Value2 = response("total"): Config.Range("B4").Value2 = "0"
    WS.Rows(2).Hidden = True
    For Each key In Array("_RequestID", "_ItemID", "_ItemVersion", "_Original")
        WS.Columns(FieldColumn(CStr(key))).Hidden = True
    Next key
    ShowRequiredColumns
End Sub
Private Sub ShowRequiredColumns()
    Dim key As Variant
    For Each key In Split(S(Config.Range("B7").Value2), "|")
        WS.Columns(FieldColumn(CStr(key))).Hidden = False
    Next key
End Sub
Public Sub PackagingRequestRefresh()
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
    MsgBox Err.Description, vbExclamation, "Packaging Request": Resume Done
End Sub
Public Sub PackagingRequestFilter()
    Controls.Range("B6").Value2 = 1
    PackagingRequestRefresh
End Sub
Public Sub PackagingRequestNext()
    If Val(S(Controls.Range("B6").Value2)) * Val(S(Controls.Range("B7").Value2)) >= Val(S(Controls.Range("B8").Value2)) Then Exit Sub
    Controls.Range("B6").Value2 = Val(S(Controls.Range("B6").Value2)) + 1
    PackagingRequestRefresh
End Sub
Public Sub PackagingRequestPrevious()
    Controls.Range("B6").Value2 = Application.Max(1, Val(S(Controls.Range("B6").Value2)) - 1)
    PackagingRequestRefresh
End Sub
Public Sub PackagingRequestSave()
    If busy Then Exit Sub
    On Error GoTo Failed
    busy = True: ShowRequiredColumns
    If S(Config.Range("B4").Value2) = "1" Then Err.Raise 5, , "Previous Save outcome is unknown. Refresh and reconcile before saving again."
    Dim rows As New Collection, body As Object, entry As Object, delta As Object, result As Object, x As Variant
    Dim r As Long, cmd As String
    For r = 3 To LastRow()
        cmd = UCase$(Trim$(S(WS.Cells(r, FieldColumn("ItemCommand")).Value2)))
        If cmd = "" Or cmd = "N" Then cmd = "U"
        If cmd <> "U" Then Err.Raise 5, , "Row " & r & ": use N or U only. Create, assign, submit, approve and cancel in the app."
        Set delta = Changes(r, cmd)
        If delta.Count > 0 Then
            Set entry = CreateObject("Scripting.Dictionary")
            entry("row") = r: entry("command") = "U"
            entry("request_id") = CLng(WS.Cells(r, FieldColumn("_RequestID")).Value2)
            entry("item_id") = CLng(WS.Cells(r, FieldColumn("_ItemID")).Value2)
            entry("version") = S(WS.Cells(r, FieldColumn("_ItemVersion")).Value2)
            Set entry("changes") = delta
            rows.Add entry
        End If
    Next r
    If rows.Count = 0 Then MsgBox "No response changes to save.", vbInformation: GoTo Done
    If rows.Count > 500 Then Err.Raise 5, , "Save at most 500 changed items at once."
    If Not ConfirmSaveMessage(BuildSaveConfirmation("Packaging responses", 0, rows.Count, 0, "Delete")) Then GoTo Done
    Set body = CreateObject("Scripting.Dictionary"): Set body("rows") = rows
    Config.Range("B4").Value2 = "1"
    ThisWorkbook.Save
    Set result = Api("save", body)
    If result("results").Count <> rows.Count Then Err.Raise 5, , "Save result is incomplete. Refresh and reconcile."
    For Each x In result("results")
        r = CLng(x("row"))
        WS.Cells(r, FieldColumn("_Result")).Value2 = x("status")
        WS.Cells(r, FieldColumn("_Message")).NumberFormat = "@"
        WS.Cells(r, FieldColumn("_Message")).Value2 = x("message")
        If x("status") = "OK" Then
            WS.Cells(r, FieldColumn("ItemCommand")).Value2 = "N"
            WS.Cells(r, FieldColumn("_ItemVersion")).Value2 = x("version")
            Set entry = CurrentValues(r)
            WS.Cells(r, FieldColumn("_Original")).Value2 = JsonConverter.ConvertToJson(entry)
        End If
    Next x
    Config.Range("B4").Value2 = "0": ThisWorkbook.Save
    MsgBox "Save completed. Review Result and Message. Refresh to load the latest stages.", vbInformation, "Packaging Request"
Done:
    busy = False: Exit Sub
Failed:
    MsgBox Err.Description & vbCrLf & "Your entries are retained.", vbExclamation, "Packaging Request": Resume Done
End Sub
