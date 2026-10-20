Attribute VB_Name = "modProductLocal"
Option Explicit
Private busy As Boolean

Private Function WS() As Worksheet
    Set WS = ThisWorkbook.Worksheets("Product")
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
    Editable = InStr(1, "|CustomerName|ProductName|Category|WeightGrams|ShelfLifeDays|Status|", "|" & key & "|", vbBinaryCompare) > 0
End Function
Private Function Api(ByVal endpoint As String, ByVal body As Object) As Object
    Dim http As Object, base As String
    If S(Config.Range("B1").Value2) <> "product-2" Then Err.Raise vbObjectError + 3110, , "Unsupported workbook version. Download a fresh workbook."
    If endpoint = "save" Then body("template_version") = S(Config.Range("B1").Value2)
    base = S(Config.Range("B2").Value2)
    If Left$(base, 7) <> "http://" And Left$(base, 8) <> "https://" Then Err.Raise vbObjectError + 3101, , "Invalid API URL."
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
    http.SetTimeouts 5000, 5000, 15000, 120000
    http.SetAutoLogonPolicy 0
    http.Option(6) = False
    http.Open "POST", base & "/api/workbench/product-excel/" & endpoint, False
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
        If key <> "Command" And Left$(key, 1) <> "_" And Len(key) > 0 Then
            v = WS.Cells(r, c).Value2
            If Len(S(v)) = 0 Then v = Null
            If validate And Not IsNull(v) And (key = "WeightGrams" Or key = "ShelfLifeDays") Then
                If Not IsNumeric(v) Then Err.Raise vbObjectError + 3103, , "Row " & r & ": invalid numeric value for " & key
                v = CDbl(v)
                If key = "ShelfLifeDays" Then
                    If v < 0 Or v > 2147483647# Or v <> Fix(v) Then Err.Raise vbObjectError + 3103, , "Row " & r & ": Shelf life must be whole days from 0 to 2,147,483,647."
                End If
            End If
            d(key) = v
        End If
    Next c
    Set CurrentValues = d
End Function
Private Function SameValue(ByVal a As Variant, ByVal b As Variant, ByVal key As String) As Boolean
    If Len(S(a)) = 0 And Len(S(b)) = 0 Then SameValue = True: Exit Function
    If key = "WeightGrams" Or key = "ShelfLifeDays" Then
        If IsNumeric(a) And IsNumeric(b) Then SameValue = (CDbl(a) = CDbl(b)): Exit Function
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
        cmd = UCase$(Trim$(S(WS.Cells(r, FieldColumn("Command")).Value2)))
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
    Dim body As Object, layout As Object, response As Object, row As Variant, key As Variant
    Dim size As Variant, c As Long, r As Long, all As Object, mapped As Object
    size = Controls.Range("B7").Value2
    If Not IsNumeric(size) Then Err.Raise vbObjectError + 3105, , "Rows per page must be a whole number from 1 to 500."
    If CDbl(size) <> Fix(CDbl(size)) Or CDbl(size) < 1 Or CDbl(size) > 500 Then Err.Raise vbObjectError + 3105, , "Rows per page must be a whole number from 1 to 500."
    If Dirty() Then
        If Not ConfirmDiscardChanges("Product") Then Exit Sub
    End If
    Set layout = JsonConverter.ParseJson(S(Config.Range("B3").Value2))
    layout("page_size") = CLng(size)
    Set body = CreateObject("Scripting.Dictionary")
    Set body("layout") = layout
    body("page") = target
    body("search") = S(Controls.Range("B3").Value2)
    body("status") = S(Controls.Range("B4").Value2)
    body("creator") = S(Controls.Range("B5").Value2)
    Set response = Api("page", body)
    RefreshLocalDropdowns WS, response
    If LastRow() >= 3 Then WS.Range(WS.Cells(3, 1), WS.Cells(LastRow(), LastFieldColumn())).ClearContents
    r = 3
    For Each row In response("rows")
        Set all = CreateObject("Scripting.Dictionary")
        For c = 1 To LastFieldColumn()
            key = S(WS.Cells(2, c).Value2)
            WS.Cells(r, c).NumberFormat = "@"
            Select Case key
                Case "Command": WS.Cells(r, c).Value2 = ""
                Case "_ID": WS.Cells(r, c).Value2 = row("ID")
                Case "_RowVersion": WS.Cells(r, c).Value2 = row("RowVersion")
                Case "_Original", "_Result", "_Message"
                Case Else
                    If row.Exists(key) Then
                        If Not IsNull(row(key)) Then WS.Cells(r, c).Value2 = S(row(key))
                        all(key) = row(key)
                    End If
            End Select
        Next c
        WS.Cells(r, FieldColumn("_Original")).Value2 = JsonConverter.ConvertToJson(all)
        r = r + 1
    Next row
    Controls.Range("B6").Value2 = target
    Config.Range("B5").Value2 = target
    Controls.Range("B8").Value2 = response("total")
    Config.Range("B4").Value2 = "0"
    WS.Rows(2).Hidden = True
    For Each key In Array("_ID", "_RowVersion", "_Original")
        WS.Columns(FieldColumn(CStr(key))).Hidden = True
    Next key
End Sub
Private Sub ShowRequiredColumns()
    Dim key As Variant
    For Each key In Array("CustomerName", "ProductName", "Category", "WeightGrams")
        WS.Columns(FieldColumn(CStr(key))).Hidden = False
    Next key
End Sub
Public Sub ProductRefresh()
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
    MsgBox Err.Description, vbExclamation, "Product": Resume Done
End Sub
Public Sub ProductFilter()
    Controls.Range("B6").Value2 = 1
    ProductRefresh
End Sub
Public Sub ProductNext()
    If Val(S(Controls.Range("B6").Value2)) * Val(S(Controls.Range("B7").Value2)) >= Val(S(Controls.Range("B8").Value2)) Then Exit Sub
    Controls.Range("B6").Value2 = Val(S(Controls.Range("B6").Value2)) + 1
    ProductRefresh
End Sub
Public Sub ProductPrevious()
    Controls.Range("B6").Value2 = Application.Max(1, Val(S(Controls.Range("B6").Value2)) - 1)
    ProductRefresh
End Sub
Public Sub ProductNew()
    Dim key As Variant, r As Long
    If busy Then Exit Sub
    For Each key In Array("CustomerName", "ProductName", "Category", "WeightGrams")
        WS.Columns(FieldColumn(CStr(key))).Hidden = False
    Next key
    r = LastRow() + 1
    WS.Cells(r, FieldColumn("Command")).Value2 = "C"
    WS.Activate
    WS.Cells(r, FieldColumn("ProductName")).Select
End Sub
Public Sub ProductSave()
    If busy Then Exit Sub
    On Error GoTo Failed
    busy = True
    ShowRequiredColumns
    If S(Config.Range("B4").Value2) = "1" Then Err.Raise vbObjectError + 3107, , "The previous Save outcome is unknown. Refresh and reconcile before saving again."
    Dim rows As New Collection, body As Object, entry As Object, delta As Object, result As Object, x As Variant
    Dim r As Long, cmd As String, creates As Long, updates As Long, blocks As Long
    For r = 3 To LastRow()
        cmd = UCase$(Trim$(S(WS.Cells(r, FieldColumn("Command")).Value2)))
        If cmd = "" Or cmd = "N" Then cmd = "U"
        If cmd <> "C" And cmd <> "U" Then Err.Raise vbObjectError + 3108, , "Invalid command at row " & r
        Set delta = Changes(r, cmd)
        If delta.Count > 0 Or cmd = "C" Or cmd = "D" Then
            Set entry = CreateObject("Scripting.Dictionary")
            entry("row") = r: entry("command") = cmd
            If cmd <> "C" Then
                entry("id") = CLng(WS.Cells(r, FieldColumn("_ID")).Value2)
                entry("version") = S(WS.Cells(r, FieldColumn("_RowVersion")).Value2)
            End If
            Set entry("changes") = delta
            rows.Add entry
            Select Case cmd
                Case "C": creates = creates + 1
                Case "U": updates = updates + 1
                Case "D": blocks = blocks + 1
            End Select
        End If
    Next r
    If rows.Count > 500 Then Err.Raise vbObjectError + 3109, , "Save at most 500 changed rows at once."
    If Not ConfirmSaveMessage(BuildSaveConfirmation("Product", creates, updates, blocks, "Block")) Then GoTo Done
    Set body = CreateObject("Scripting.Dictionary")
    Set body("rows") = rows
    Config.Range("B4").Value2 = "1"
    ' Persist retry protection before a network write; never blindly retry creates.
    ThisWorkbook.Save
    Set result = Api("save", body)
    For Each x In result("results")
        r = CLng(x("RowNum"))
        WS.Cells(r, FieldColumn("_Result")).Value2 = x("Status")
        WS.Cells(r, FieldColumn("_Message")).NumberFormat = "@"
        WS.Cells(r, FieldColumn("_Message")).Value2 = x("Message")
        If x("Status") = "OK" Then
            WS.Cells(r, FieldColumn("Command")).Value2 = ""
            WS.Cells(r, FieldColumn("_ID")).Value2 = x("NewID")
            WS.Cells(r, FieldColumn("_RowVersion")).Value2 = x("NewRowVersion")
            If x.Exists("NewProductCode") Then
                If Not IsNull(x("NewProductCode")) Then WS.Cells(r, FieldColumn("ProductCode")).Value2 = x("NewProductCode")
            End If
            Set entry = CurrentValues(r)
            WS.Cells(r, FieldColumn("_Original")).Value2 = JsonConverter.ConvertToJson(entry)
        End If
    Next x
    Config.Range("B4").Value2 = "0"
    ThisWorkbook.Save
    MsgBox "Save completed. Review Result and Message columns. Refresh to load calculated values.", vbInformation, "Product"
Done:
    busy = False
    Exit Sub
Failed:
    MsgBox Err.Description & vbCrLf & "Your entries are retained.", vbExclamation, "Product"
    Resume Done
End Sub
