Attribute VB_Name = "modAdminMasterBridge"
Option Explicit

' Public interface used by workbook buttons.
Public Sub SaveMarketSheet(): SaveAdminSheet "Market": End Sub
Public Sub RefreshMarketSheet(): RefreshAdminSheet "Market": End Sub
Public Sub ConfigureMarketSheet(): ConfigureAdminSheet "Market": End Sub
Public Sub SaveCurrencySheet(): SaveAdminSheet "Currency": End Sub
Public Sub RefreshCurrencySheet(): RefreshAdminSheet "Currency": End Sub
Public Sub ConfigureCurrencySheet(): ConfigureAdminSheet "Currency": End Sub
Public Sub SaveUsersSheet(): SaveAdminSheet "Users": End Sub
Public Sub RefreshUsersSheet(): RefreshAdminSheet "Users": End Sub
Public Sub ConfigureUsersSheet(): ConfigureAdminSheet "Users": End Sub
Public Sub SaveUserAccessSheet(): SaveAdminSheet "User Access": End Sub
Public Sub RefreshUserAccessSheet(): RefreshAdminSheet "User Access": End Sub
Public Sub ConfigureUserAccessSheet(): ConfigureAdminSheet "User Access": End Sub

Public Sub ConfigureAdminSheet(ByVal entityName As String)
    Dim ws As Worksheet: Set ws = AdminWorksheet(entityName)
    ws.Range("A1:" & AdminLastColumn(entityName) & "1").Value = AdminHeaders(entityName)
    ws.Columns("A:E").Hidden = False
    ws.Columns("F:" & AdminLastColumn(entityName)).Hidden = True
    SetAdminValidation ws.Range("A2:A1000"), "C,U,D,N"

    If entityName = "Users" Then SetAdminValidation ws.Range("C2:C1000"), "TRUE,FALSE"
    If entityName = "User Access" Then
        SetAdminValidation ws.Range("C2:C1000"), "Admin,Customer,Product,Opportunity"
        ConfigureUserNameValidation ws
    End If
End Sub

Public Sub RefreshAdminSheet(ByVal entityName As String)
    Dim ws As Worksheet: Set ws = AdminWorksheet(entityName)
    ConfigureAdminSheet entityName
    If Not CanReplaceAdminRows(ws) Then Exit Sub
    On Error GoTo Failed

    Dim response As Object: Set response = GetJson(AdminReadEndpoint(entityName))
    Dim lastRow As Long: lastRow = LastAdminRow(ws)
    If lastRow >= 2 Then ws.Range("A2:" & AdminLastColumn(entityName) & lastRow).ClearContents

    Dim item As Variant, r As Long: r = 2
    For Each item In response("rows")
        WriteAdminReadRow entityName, ws, r, item
        r = r + 1
    Next item
    ws.Columns("F:" & AdminLastColumn(entityName)).Hidden = True
    Exit Sub
Failed:
    MsgBox "Refresh failed: " & Err.Description, vbCritical
End Sub

Public Sub SaveAdminSheet(ByVal entityName As String)
    Dim ws As Worksheet: Set ws = AdminWorksheet(entityName)
    ConfigureAdminSheet entityName
    If Not ConfirmAdminMasterSaveAligned(ws, entityName) Then Exit Sub
    On Error GoTo Failed

    Dim rows As Collection: Set rows = New Collection
    Dim r As Long, cmd As String
    For r = 2 To LastAdminRow(ws)
        cmd = UCase$(Trim$(CStr(ws.Cells(r, "A").Value & "")))
        If cmd <> "" And cmd <> "N" Then rows.Add BuildAdminRow(entityName, ws, r, cmd)
    Next r

    Dim payload As Object: Set payload = CreateObject("Scripting.Dictionary")
    payload.Add "rows", rows
    Dim response As Object
    Set response = PostJson(AdminWriteEndpoint(entityName), ConvertToJson(payload))
    ApplyAdminResultsAligned entityName, ws, response("results")
    ws.Columns("F:" & AdminLastColumn(entityName)).Hidden = True
    MsgBox rows.Count & " row(s) submitted.", vbInformation
    Exit Sub
Failed:
    MsgBox "Save failed: " & Err.Description, vbCritical
End Sub

' Pure message builder used by the confirmation dialog and regression tests.
Public Function AdminConfirmationMessage(ByVal ws As Worksheet, ByVal entityName As String) As String
    Dim r As Long, cmd As String, createCount As Long, updateCount As Long, deleteCount As Long
    For r = 2 To LastAdminRow(ws)
        cmd = UCase$(Trim$(CStr(ws.Cells(r, "A").Value & "")))
        Select Case cmd
            Case "C": createCount = createCount + 1
            Case "U": updateCount = updateCount + 1
            Case "D": deleteCount = deleteCount + 1
            Case "", "N"
            Case Else
                Err.Raise vbObjectError + 2601, , "Row " & r & ": Command must be C, U, D, or N."
        End Select
    Next r
    If createCount + updateCount + deleteCount = 0 Then Exit Function

    Dim deleteLabel As String: deleteLabel = IIf(entityName = "Users", "Deactivate", "Delete")
    AdminConfirmationMessage = "Confirm " & entityName & " changes:" & vbCrLf & vbCrLf & _
        "Create: " & createCount & vbCrLf & "Update: " & updateCount & vbCrLf & _
        deleteLabel & ": " & deleteCount
    If deleteCount > 0 And entityName <> "Users" Then _
        AdminConfirmationMessage = AdminConfirmationMessage & vbCrLf & vbCrLf & "Delete is permanent."
End Function

Private Function ConfirmAdminMasterSaveAligned(ByVal ws As Worksheet, ByVal entityName As String) As Boolean
    On Error GoTo InvalidCommand
    Dim message As String: message = AdminConfirmationMessage(ws, entityName)
    If Len(message) = 0 Then MsgBox "No changed rows to save.", vbInformation: Exit Function
    ConfirmAdminMasterSaveAligned = (MsgBox(message, vbYesNo + vbQuestion, "Confirm Save") = vbYes)
    Exit Function
InvalidCommand:
    MsgBox Err.Description, vbExclamation
End Function

Private Function BuildAdminRow(ByVal entityName As String, ByVal ws As Worksheet, ByVal r As Long, ByVal cmd As String) As Object
    If cmd <> "C" Then RequireAdminKeys ws, r, AdminRowVersionColumn(entityName)
    Dim row As Object: Set row = CreateObject("Scripting.Dictionary")
    row.Add "RowNum", r
    row.Add "Command", cmd

    Select Case entityName
        Case "Market"
            row.Add "ID", AdminNullableNumber(ws.Cells(r, "F").Value)
            row.Add "MarketCode", AdminNullableText(ws.Cells(r, "B").Value)
            row.Add "MarketName", AdminNullableText(ws.Cells(r, "C").Value)
            row.Add "RowVersion", AdminNullableText(ws.Cells(r, "G").Value)
        Case "Currency"
            row.Add "ID", AdminNullableNumber(ws.Cells(r, "F").Value)
            row.Add "CurrencyCode", AdminNullableText(ws.Cells(r, "B").Value)
            row.Add "CurrencyName", AdminNullableText(ws.Cells(r, "C").Value)
            row.Add "RowVersion", AdminNullableText(ws.Cells(r, "G").Value)
        Case "Users"
            row.Add "ID", AdminNullableNumber(ws.Cells(r, "F").Value)
            row.Add "UserName", AdminNullableText(ws.Cells(r, "B").Value)
            If cmd = "D" Then row.Add "IsActive", False Else row.Add "IsActive", AdminBoolean(ws.Cells(r, "C").Value, r)
            row.Add "RowVersion", AdminNullableText(ws.Cells(r, "G").Value)
        Case "User Access"
            row.Add "AccessID", AdminNullableNumber(ws.Cells(r, "F").Value)
            If cmd = "C" Or cmd = "U" Then ws.Cells(r, "G").Value = UserIDByName(ws.Cells(r, "B").Value)
            row.Add "UserID", AdminNullableNumber(ws.Cells(r, "G").Value)
            row.Add "Scope", AdminNullableText(ws.Cells(r, "C").Value)
            row.Add "RowVersion", AdminNullableText(ws.Cells(r, "H").Value)
        Case Else
            Err.Raise vbObjectError + 2602, , "Unknown Admin Master entity: " & entityName
    End Select
    Set BuildAdminRow = row
End Function

Private Sub WriteAdminReadRow(ByVal entityName As String, ByVal ws As Worksheet, ByVal r As Long, ByVal item As Variant)
    ws.Cells(r, "A").Value = "N"
    Select Case entityName
        Case "Market"
            ws.Cells(r, "B").Value = item("MarketCode"): ws.Cells(r, "C").Value = item("MarketName")
            ws.Cells(r, "F").Value = item("ID"): ws.Cells(r, "G").Value = item("RowVersion")
        Case "Currency"
            ws.Cells(r, "B").Value = item("CurrencyCode"): ws.Cells(r, "C").Value = item("CurrencyName")
            ws.Cells(r, "F").Value = item("ID"): ws.Cells(r, "G").Value = item("RowVersion")
        Case "Users"
            ws.Cells(r, "B").Value = item("UserName"): ws.Cells(r, "C").Value = item("IsActive")
            ws.Cells(r, "F").Value = item("ID"): ws.Cells(r, "G").Value = item("RowVersion")
        Case "User Access"
            ws.Cells(r, "B").Value = item("UserName"): ws.Cells(r, "C").Value = item("Scope")
            ws.Cells(r, "F").Value = item("AccessID"): ws.Cells(r, "G").Value = item("UserID"): ws.Cells(r, "H").Value = item("RowVersion")
    End Select
End Sub

Private Sub ApplyAdminResultsAligned(ByVal entityName As String, ByVal ws As Worksheet, ByVal results As Object)
    Dim item As Variant, r As Long, originalCommand As String, rvCol As String
    rvCol = AdminRowVersionColumn(entityName)
    For Each item In results
        r = item("RowNum"): originalCommand = UCase$(Trim$(CStr(ws.Cells(r, "A").Value & "")))
        ws.Cells(r, "D").Value = item("Status"): ws.Cells(r, "E").Value = item("Message")
        If item("Status") = "OK" Then
            If Not IsNull(item("NewID")) Then ws.Cells(r, "F").Value = item("NewID")
            If Not IsNull(item("NewRowVersion")) Then ws.Cells(r, rvCol).Value = item("NewRowVersion")
            If originalCommand = "D" And entityName = "Users" Then ws.Cells(r, "C").Value = False
            If originalCommand = "D" And entityName <> "Users" Then
                ws.Range("B" & r & ":C" & r).ClearContents
                ws.Range("F" & r & ":" & AdminLastColumn(entityName) & r).ClearContents
            End If
            ws.Cells(r, "A").Value = "N"
        End If
    Next item
End Sub

Private Function AdminHeaders(ByVal entityName As String) As Variant
    Select Case entityName
        Case "Market": AdminHeaders = Array("Command", "Market Code", "Market Name", "Result Status", "Message", "ID", "RowVersion")
        Case "Currency": AdminHeaders = Array("Command", "Currency Code", "Currency Name", "Result Status", "Message", "ID", "RowVersion")
        Case "Users": AdminHeaders = Array("Command", "User Name", "Is Active", "Result Status", "Message", "ID", "RowVersion")
        Case "User Access": AdminHeaders = Array("Command", "User Name", "Scope", "Result Status", "Message", "Access ID", "User ID", "RowVersion")
        Case Else: Err.Raise vbObjectError + 2603, , "Unknown Admin Master entity: " & entityName
    End Select
End Function

Private Function AdminWorksheet(ByVal entityName As String) As Worksheet
    Set AdminWorksheet = ThisWorkbook.Worksheets(entityName)
End Function

Private Function AdminLastColumn(ByVal entityName As String) As String
    AdminLastColumn = IIf(entityName = "User Access", "H", "G")
End Function

Private Function AdminRowVersionColumn(ByVal entityName As String) As String
    AdminRowVersionColumn = IIf(entityName = "User Access", "H", "G")
End Function

Private Function AdminReadEndpoint(ByVal entityName As String) As String
    Select Case entityName
        Case "Market": AdminReadEndpoint = "/api/market"
        Case "Currency": AdminReadEndpoint = "/api/currency"
        Case "Users": AdminReadEndpoint = "/api/user"
        Case "User Access": AdminReadEndpoint = "/api/user-access"
    End Select
End Function

Private Function AdminWriteEndpoint(ByVal entityName As String) As String
    AdminWriteEndpoint = AdminReadEndpoint(entityName) & "/batch"
End Function

Private Function LastAdminRow(ByVal ws As Worksheet) As Long
    LastAdminRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
End Function

Private Function CanReplaceAdminRows(ByVal ws As Worksheet) As Boolean
    Dim r As Long, cmd As String
    For r = 2 To LastAdminRow(ws)
        cmd = UCase$(Trim$(CStr(ws.Cells(r, "A").Value & "")))
        If cmd <> "" And cmd <> "N" Then
            CanReplaceAdminRows = (MsgBox("Unsaved changes will be discarded. Continue?", vbYesNo + vbExclamation) = vbYes)
            Exit Function
        End If
    Next r
    CanReplaceAdminRows = True
End Function

Private Sub RequireAdminKeys(ByVal ws As Worksheet, ByVal r As Long, ByVal rvCol As String)
    If Len(Trim$(CStr(ws.Cells(r, "F").Value & ""))) = 0 Or Len(Trim$(CStr(ws.Cells(r, rvCol).Value & ""))) = 0 Then
        Err.Raise vbObjectError + 2604, , "Row " & r & ": Update/Delete requires ID and RowVersion. Refresh first."
    End If
End Sub

Private Sub SetAdminValidation(ByVal target As Range, ByVal values As String)
    On Error Resume Next: target.Validation.Delete: On Error GoTo 0
    target.Validation.Add Type:=xlValidateList, AlertStyle:=xlValidAlertStop, Formula1:=values
    target.Validation.IgnoreBlank = True: target.Validation.InCellDropdown = True
End Sub

Private Sub ConfigureUserNameValidation(ByVal ws As Worksheet)
    On Error Resume Next: ThisWorkbook.Names("AdminUserNames").Delete: On Error GoTo 0
    ThisWorkbook.Names.Add Name:="AdminUserNames", RefersTo:="=Users!$B$2:INDEX(Users!$B:$B,MAX(2,COUNTA(Users!$B:$B)))"
    On Error Resume Next: ws.Range("B2:B1000").Validation.Delete: On Error GoTo 0
    ws.Range("B2:B1000").Validation.Add Type:=xlValidateList, AlertStyle:=xlValidAlertStop, Formula1:="=AdminUserNames"
    ws.Range("B2:B1000").Validation.IgnoreBlank = True: ws.Range("B2:B1000").Validation.InCellDropdown = True
End Sub

Private Function UserIDByName(ByVal value As Variant) As Long
    Dim found As Range
    Set found = ThisWorkbook.Worksheets("Users").Columns("B").Find(What:=Trim$(CStr(value & "")), LookIn:=xlValues, LookAt:=xlWhole, MatchCase:=False)
    If found Is Nothing Then Err.Raise vbObjectError + 2605, , "User Name was not found on the Users sheet. Refresh Users first."
    If Len(CStr(ThisWorkbook.Worksheets("Users").Cells(found.Row, "F").Value & "")) = 0 Then Err.Raise vbObjectError + 2606, , "The selected user has no saved ID."
    UserIDByName = CLng(ThisWorkbook.Worksheets("Users").Cells(found.Row, "F").Value)
End Function

Private Function AdminNullableText(ByVal value As Variant) As Variant
    If Len(Trim$(CStr(value & ""))) = 0 Then AdminNullableText = Null Else AdminNullableText = CStr(value)
End Function

Private Function AdminNullableNumber(ByVal value As Variant) As Variant
    If Len(Trim$(CStr(value & ""))) = 0 Then AdminNullableNumber = Null Else AdminNullableNumber = CLng(value)
End Function

Private Function AdminBoolean(ByVal value As Variant, ByVal r As Long) As Boolean
    Dim text As String: text = UCase$(Trim$(CStr(value & "")))
    If text = "TRUE" Or text = "1" Then AdminBoolean = True: Exit Function
    If text = "FALSE" Or text = "0" Then AdminBoolean = False: Exit Function
    Err.Raise vbObjectError + 2607, , "Row " & r & ": Is Active must be TRUE or FALSE."
End Function
