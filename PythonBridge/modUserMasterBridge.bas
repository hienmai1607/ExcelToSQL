Attribute VB_Name = "modUserMasterBridge"
Option Explicit

' Public button interface. The implementation is shared by both User Master
' entities even though Product and Customer live in separate workbooks.
Public Sub SaveProductSheet(): SaveUserMasterSheet "Product": End Sub
Public Sub RefreshProductSheet(): RefreshUserMasterSheet "Product": End Sub
Public Sub ConfigureProductSheet(): ConfigureUserMasterSheet "Product": End Sub
Public Sub PreviousProductPage(): ChangeUserMasterPage "Product", -1: End Sub
Public Sub NextProductPage(): ChangeUserMasterPage "Product", 1: End Sub
Public Sub SaveCustomerSheet(): SaveUserMasterSheet "Customer": End Sub
Public Sub RefreshCustomerSheet(): RefreshUserMasterSheet "Customer": End Sub
Public Sub ConfigureCustomerSheet(): ConfigureUserMasterSheet "Customer": End Sub
Public Sub PreviousCustomerPage(): ChangeUserMasterPage "Customer", -1: End Sub
Public Sub NextCustomerPage(): ChangeUserMasterPage "Customer", 1: End Sub

Public Sub ConfigureUserMasterSheet(ByVal entityName As String)
    Dim ws As Worksheet: Set ws = ThisWorkbook.Worksheets(entityName)
    ConfigurePagination ws
    ws.Range("A1:" & UserMasterLastColumn(entityName) & "1").Value = UserMasterHeaders(entityName)
    ws.Columns("A:" & UserMasterLastVisibleColumn(entityName)).Hidden = False
    ws.Columns(UserMasterIDColumn(entityName) & ":" & UserMasterLastColumn(entityName)).Hidden = True
    SetUserMasterValidation ws.Range("A2:A1000"), "C,U,D,N"

    If entityName = "Product" Then
        SetUserMasterValidation ws.Range("E2:E1000"), "g,oz"
        SetUserMasterValidation ws.Range("F2:F1000"), "Active,Block"
        If Len(Trim$(CStr(ws.Range("N4").Value & ""))) = 0 Then ws.Range("N4").Value = 1
    ElseIf entityName = "Customer" Then
        RefreshCustomerValidation ws
        If Len(Trim$(CStr(ws.Range("M5").Value & ""))) = 0 Then ws.Range("M5").Value = 1
    End If
End Sub

Public Sub RefreshUserMasterSheet(ByVal entityName As String, Optional ByVal direction As Long = 0)
    On Error GoTo Failed
    Dim ws As Worksheet: Set ws = ThisWorkbook.Worksheets(entityName)
    ConfigureUserMasterSheet entityName
    If Not CanReplaceUserMasterRows(ws) Then Exit Sub
    If entityName = "Customer" Then RefreshCustomerLookups

    Dim filters As String: filters = UserMasterReadUrl(entityName, ws)
    Dim page As Long: page = RequestedPage(ws, direction, filters)
    Dim response As Object: Set response = GetJson(filters & "&page=" & page)
    If response("rows").Count = 0 And page > 1 Then
        page = Application.Max(1, -Int(-CLng(response("total")) / RowsPerPage(ws)))
        Set response = GetJson(filters & "&page=" & page)
    End If
    Dim lastRow As Long: lastRow = LastUserMasterRow(ws)
    If lastRow >= 2 Then ws.Range("A2:" & UserMasterLastColumn(entityName) & lastRow).ClearContents

    Dim item As Variant, r As Long: r = 2
    For Each item In response("rows")
        WriteUserMasterRow entityName, ws, r, item
        r = r + 1
    Next item
    ws.Columns(UserMasterIDColumn(entityName) & ":" & UserMasterLastColumn(entityName)).Hidden = True
    CommitPage ws, page, r - 2, CLng(response("total")), filters
    Exit Sub
Failed:
    MsgBox "Refresh failed: " & Err.Description, vbCritical
End Sub

Public Sub SaveUserMasterSheet(ByVal entityName As String)
    On Error GoTo Failed
    Dim ws As Worksheet: Set ws = ThisWorkbook.Worksheets(entityName)
    ConfigureUserMasterSheet entityName
    If Not ConfirmUserMasterSave(ws, entityName) Then Exit Sub
    If entityName = "Customer" Then EnsureCustomerLookups

    Dim rows As Collection: Set rows = New Collection
    Dim r As Long, cmd As String
    For r = 2 To LastUserMasterRow(ws)
        cmd = UCase$(Trim$(CStr(ws.Cells(r, "A").Value & "")))
        If cmd <> "" And cmd <> "N" Then rows.Add BuildUserMasterRow(entityName, ws, r, cmd)
    Next r

    Dim payload As Object: Set payload = CreateObject("Scripting.Dictionary")
    payload.Add "rows", rows
    Dim response As Object
    Set response = PostJson(UserMasterWriteEndpoint(entityName), ConvertToJson(payload))
    ApplyUserMasterResults entityName, ws, response("results")
    ws.Columns(UserMasterIDColumn(entityName) & ":" & UserMasterLastColumn(entityName)).Hidden = True
    MsgBox rows.Count & " row(s) submitted.", vbInformation
    Exit Sub
Failed:
    MsgBox "Save failed: " & Err.Description, vbCritical
End Sub

' Pure message builder used by the confirmation dialog and workbook tests.
Public Function UserMasterConfirmationMessage(ByVal ws As Worksheet, ByVal entityName As String) As String
    UserMasterConfirmationMessage = CommandConfirmationMessage(ws, entityName, 1, 2, LastUserMasterRow(ws), "Block")
End Function

Private Function ConfirmUserMasterSave(ByVal ws As Worksheet, ByVal entityName As String) As Boolean
    Dim message As String: message = UserMasterConfirmationMessage(ws, entityName)
    ConfirmUserMasterSave = ConfirmSaveMessage(message)
End Function

Private Function BuildUserMasterRow(ByVal entityName As String, ByVal ws As Worksheet, ByVal r As Long, ByVal cmd As String) As Object
    If cmd <> "C" Then RequireUserMasterKeys ws, r, UserMasterRowVersionColumn(entityName)
    Dim row As Object: Set row = CreateObject("Scripting.Dictionary")
    row.Add "RowNum", r
    row.Add "Command", cmd

    If entityName = "Product" Then
        row.Add "ID", UserMasterNullableLong(ws.Cells(r, "I").Value)
        If cmd = "C" Or cmd = "U" Then ValidateProductRow ws, r
        row.Add "ProductCode", UserMasterNullableText(ws.Cells(r, "B").Value)
        row.Add "ProductName", UserMasterNullableText(ws.Cells(r, "C").Value)
        row.Add "WeightValue", UserMasterNullableDouble(ws.Cells(r, "D").Value)
        row.Add "WeightUnit", UserMasterNullableText(ws.Cells(r, "E").Value)
        If cmd = "C" Then row.Add "Status", Null Else row.Add "Status", UserMasterNullableText(ws.Cells(r, "F").Value)
        row.Add "RowVersion", UserMasterNullableText(ws.Cells(r, "J").Value)
    ElseIf entityName = "Customer" Then
        row.Add "ID", UserMasterNullableLong(ws.Cells(r, "H").Value)
        If cmd = "C" Or cmd = "U" Then PrepareCustomerRow ws, r, cmd
        row.Add "CustomerName", UserMasterNullableText(ws.Cells(r, "B").Value)
        row.Add "MarketID", UserMasterNullableLong(ws.Cells(r, "I").Value)
        row.Add "CurrencyID", UserMasterNullableLong(ws.Cells(r, "J").Value)
        If cmd = "C" Then row.Add "Status", Null Else row.Add "Status", UserMasterNullableText(ws.Cells(r, "E").Value)
        row.Add "RowVersion", UserMasterNullableText(ws.Cells(r, "K").Value)
    Else
        Err.Raise vbObjectError + 2702, , "Unknown User Master entity: " & entityName
    End If
    Set BuildUserMasterRow = row
End Function

Private Sub ValidateProductRow(ByVal ws As Worksheet, ByVal r As Long)
    If Len(Trim$(CStr(ws.Cells(r, "B").Value & ""))) = 0 Or _
       Len(Trim$(CStr(ws.Cells(r, "C").Value & ""))) = 0 Or _
       Len(Trim$(CStr(ws.Cells(r, "D").Value & ""))) = 0 Then
        Err.Raise vbObjectError + 2703, , "Row " & r & ": Product Code, Product Name, and Weight Value are required."
    End If
    If Not IsNumeric(ws.Cells(r, "D").Value) Then Err.Raise vbObjectError + 2704, , "Row " & r & ": Weight Value must be numeric."
    If CDbl(ws.Cells(r, "D").Value) <= 0 Then Err.Raise vbObjectError + 2704, , "Row " & r & ": Weight Value must be greater than zero."
    ws.Cells(r, "B").Value = UCase$(Trim$(CStr(ws.Cells(r, "B").Value)))
    Dim unitText As String: unitText = LCase$(Trim$(CStr(ws.Cells(r, "E").Value & "")))
    If Len(unitText) = 0 Then unitText = "g": ws.Cells(r, "E").Value = unitText
    If unitText <> "g" And unitText <> "oz" Then Err.Raise vbObjectError + 2705, , "Row " & r & ": Weight Unit must be g or oz."
    Dim statusText As String: statusText = Trim$(CStr(ws.Cells(r, "F").Value & ""))
    If Len(statusText) > 0 And statusText <> "Active" And statusText <> "Block" Then _
        Err.Raise vbObjectError + 2713, , "Row " & r & ": Status must be Active or Block."
End Sub

Private Sub PrepareCustomerRow(ByVal ws As Worksheet, ByVal r As Long, ByVal cmd As String)
    If Len(Trim$(CStr(ws.Cells(r, "B").Value & ""))) = 0 Or _
       Len(Trim$(CStr(ws.Cells(r, "C").Value & ""))) = 0 Or _
       Len(Trim$(CStr(ws.Cells(r, "D").Value & ""))) = 0 Then
        Err.Raise vbObjectError + 2706, , "Row " & r & ": Customer Name, Market Code, and Currency Code are required."
    End If
    ws.Cells(r, "I").Value = CustomerLookupID("Market", ws.Cells(r, "C").Value)
    ws.Cells(r, "J").Value = CustomerLookupID("Currency", ws.Cells(r, "D").Value)
    If Len(Trim$(CStr(ws.Cells(r, "I").Value & ""))) = 0 Then Err.Raise vbObjectError + 2707, , "Row " & r & ": Market Code was not found. Refresh Customer first."
    If Len(Trim$(CStr(ws.Cells(r, "J").Value & ""))) = 0 Then Err.Raise vbObjectError + 2708, , "Row " & r & ": Currency Code was not found. Refresh Customer first."
    If cmd = "C" Then ws.Cells(r, "E").ClearContents
    Dim statusText As String: statusText = Trim$(CStr(ws.Cells(r, "E").Value & ""))
    If Len(statusText) > 0 And statusText <> "Active" And statusText <> "Block" Then _
        Err.Raise vbObjectError + 2709, , "Row " & r & ": Status must be Active or Block."
End Sub

Private Sub WriteUserMasterRow(ByVal entityName As String, ByVal ws As Worksheet, ByVal r As Long, ByVal item As Variant)
    ws.Cells(r, "A").Value = "N"
    If entityName = "Product" Then
        ws.Cells(r, "B").Value = item("ProductCode")
        ws.Cells(r, "C").Value = item("ProductName")
        ws.Cells(r, "D").Value = item("WeightGrams")
        ws.Cells(r, "E").Value = "g"
        ws.Cells(r, "F").Value = item("Status")
        ws.Cells(r, "I").Value = item("ID")
        ws.Cells(r, "J").Value = item("RowVersion")
    Else
        ws.Cells(r, "B").Value = item("CustomerName")
        ws.Cells(r, "C").Value = item("MarketCode")
        ws.Cells(r, "D").Value = item("CurrencyCode")
        ws.Cells(r, "E").Value = item("Status")
        ws.Cells(r, "H").Value = item("ID")
        ws.Cells(r, "I").Value = item("MarketID")
        ws.Cells(r, "J").Value = item("CurrencyID")
        ws.Cells(r, "K").Value = item("RowVersion")
    End If
End Sub

Private Sub ApplyUserMasterResults(ByVal entityName As String, ByVal ws As Worksheet, ByVal results As Object)
    Dim item As Variant, r As Long, originalCommand As String
    For Each item In results
        r = item("RowNum")
        originalCommand = UCase$(Trim$(CStr(ws.Cells(r, "A").Value & "")))
        ws.Cells(r, UserMasterResultColumn(entityName)).Value = item("Status")
        ws.Cells(r, UserMasterMessageColumn(entityName)).Value = item("Message")
        If item("Status") = "OK" Then
            If Not IsNull(item("NewID")) Then ws.Cells(r, UserMasterIDColumn(entityName)).Value = item("NewID")
            If Not IsNull(item("NewRowVersion")) Then ws.Cells(r, UserMasterRowVersionColumn(entityName)).Value = item("NewRowVersion")
            If originalCommand = "C" Or originalCommand = "D" Then ws.Cells(r, UserMasterStatusColumn(entityName)).Value = IIf(originalCommand = "D", "Block", "Active")
            ws.Cells(r, "A").Value = "N"
        End If
    Next item
End Sub

Private Function UserMasterHeaders(ByVal entityName As String) As Variant
    If entityName = "Product" Then
        UserMasterHeaders = Array("Command", "Product Code", "Product Name", "Weight Value", "Weight Unit", "Status", "Result Status", "Message", "ID", "RowVersion")
    ElseIf entityName = "Customer" Then
        UserMasterHeaders = Array("Command", "Customer Name", "Market Code", "Currency Code", "Status (Update only: Active/Block)", "Result Status", "Message", "Customer ID", "Market ID", "Currency ID", "RowVersion")
    Else
        Err.Raise vbObjectError + 2710, , "Unknown User Master entity: " & entityName
    End If
End Function

Private Function UserMasterLastColumn(ByVal entityName As String) As String
    If entityName = "Product" Then UserMasterLastColumn = "J" Else UserMasterLastColumn = "K"
End Function

Private Function UserMasterRowVersionColumn(ByVal entityName As String) As String
    If entityName = "Product" Then UserMasterRowVersionColumn = "J" Else UserMasterRowVersionColumn = "K"
End Function

Private Function UserMasterLastVisibleColumn(ByVal entityName As String) As String
    If entityName = "Product" Then UserMasterLastVisibleColumn = "H" Else UserMasterLastVisibleColumn = "G"
End Function

Private Function UserMasterIDColumn(ByVal entityName As String) As String
    If entityName = "Product" Then UserMasterIDColumn = "I" Else UserMasterIDColumn = "H"
End Function

Private Function UserMasterResultColumn(ByVal entityName As String) As String
    If entityName = "Product" Then UserMasterResultColumn = "G" Else UserMasterResultColumn = "F"
End Function

Private Function UserMasterMessageColumn(ByVal entityName As String) As String
    If entityName = "Product" Then UserMasterMessageColumn = "H" Else UserMasterMessageColumn = "G"
End Function

Private Function UserMasterStatusColumn(ByVal entityName As String) As String
    If entityName = "Product" Then UserMasterStatusColumn = "F" Else UserMasterStatusColumn = "E"
End Function

Private Function UserMasterWriteEndpoint(ByVal entityName As String) As String
    UserMasterWriteEndpoint = "/api/" & LCase$(entityName) & "/batch"
End Function

Private Function UserMasterReadUrl(ByVal entityName As String, ByVal ws As Worksheet) As String
    Dim url As String
    If entityName = "Product" Then
        url = "/api/product?page_size=" & RowsPerPage(ws)
        If Len(Trim$(CStr(ws.Range("N2").Value & ""))) > 0 Then url = url & "&product_code=" & UrlEncode(Trim$(CStr(ws.Range("N2").Value)))
        If Len(Trim$(CStr(ws.Range("N3").Value & ""))) > 0 Then url = url & "&product_name=" & UrlEncode(Trim$(CStr(ws.Range("N3").Value)))
    Else
        url = "/api/customer?page_size=" & RowsPerPage(ws)
        If Len(Trim$(CStr(ws.Range("M2").Value & ""))) > 0 Then url = url & "&customer_name=" & UrlEncode(Trim$(CStr(ws.Range("M2").Value)))
        If Len(Trim$(CStr(ws.Range("M3").Value & ""))) > 0 Then
            Dim marketID As Variant: marketID = CustomerLookupID("Market", ws.Range("M3").Value)
            If Len(Trim$(CStr(marketID & ""))) = 0 Then Err.Raise vbObjectError + 2711, , "Market Code filter was not found. Refresh Customer first."
            url = url & "&market_id=" & CLng(marketID)
        End If
        If Len(Trim$(CStr(ws.Range("M4").Value & ""))) > 0 Then url = url & "&status=" & UrlEncode(Trim$(CStr(ws.Range("M4").Value)))
    End If
    UserMasterReadUrl = url
End Function

Private Function UserMasterPage(ByVal ws As Worksheet, ByVal entityName As String) As Long
    Dim pageCell As String: pageCell = IIf(entityName = "Product", "N4", "M5")
    If IsNumeric(ws.Range(pageCell).Value) Then UserMasterPage = CLng(ws.Range(pageCell).Value)
    If UserMasterPage < 1 Then UserMasterPage = 1
End Function

Private Sub ChangeUserMasterPage(ByVal entityName As String, ByVal direction As Long)
    RefreshUserMasterSheet entityName, direction
End Sub

Private Function LastUserMasterRow(ByVal ws As Worksheet) As Long
    LastUserMasterRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
End Function

Private Function CanReplaceUserMasterRows(ByVal ws As Worksheet) As Boolean
    Dim r As Long, cmd As String
    For r = 2 To LastUserMasterRow(ws)
        cmd = UCase$(Trim$(CStr(ws.Cells(r, "A").Value & "")))
        If cmd <> "" And cmd <> "N" Then
            CanReplaceUserMasterRows = ConfirmDiscardChanges(ws.Name)
            Exit Function
        End If
    Next r
    CanReplaceUserMasterRows = True
End Function

Private Sub RequireUserMasterKeys(ByVal ws As Worksheet, ByVal r As Long, ByVal rowVersionColumn As String)
    Dim entityName As String: entityName = ws.Name
    If Len(Trim$(CStr(ws.Cells(r, UserMasterIDColumn(entityName)).Value & ""))) = 0 Or _
       Len(Trim$(CStr(ws.Cells(r, rowVersionColumn).Value & ""))) = 0 Then
        Err.Raise vbObjectError + 2712, , "Row " & r & ": Update/Delete requires ID and RowVersion. Refresh first."
    End If
End Sub

Private Sub SetUserMasterValidation(ByVal target As Range, ByVal values As String)
    On Error Resume Next: target.Validation.Delete: On Error GoTo 0
    target.Validation.Add Type:=xlValidateList, AlertStyle:=xlValidAlertStop, Formula1:=values
    target.Validation.IgnoreBlank = True
    target.Validation.InCellDropdown = True
End Sub

Private Sub RefreshCustomerValidation(ByVal ws As Worksheet)
    On Error Resume Next
    ThisWorkbook.Names("CustomerMarketCodes").Delete
    ThisWorkbook.Names("CustomerCurrencyCodes").Delete
    On Error GoTo 0
    ThisWorkbook.Names.Add Name:="CustomerMarketCodes", RefersTo:="='_Lookups'!$D$2:INDEX('_Lookups'!$D:$D,MAX(2,COUNTA('_Lookups'!$D:$D)))"
    ThisWorkbook.Names.Add Name:="CustomerCurrencyCodes", RefersTo:="='_Lookups'!$F$2:INDEX('_Lookups'!$F:$F,MAX(2,COUNTA('_Lookups'!$F:$F)))"
    SetUserMasterValidation ws.Range("C2:C1000"), "=CustomerMarketCodes"
    SetUserMasterValidation ws.Range("D2:D1000"), "=CustomerCurrencyCodes"
    SetUserMasterValidation ws.Range("E2:E1000"), "Active,Block"
End Sub

Private Sub EnsureCustomerLookups()
    Dim lookupSheet As Worksheet: Set lookupSheet = ThisWorkbook.Worksheets("_Lookups")
    If Len(Trim$(CStr(lookupSheet.Range("D2").Value & ""))) = 0 Or _
       Len(Trim$(CStr(lookupSheet.Range("F2").Value & ""))) = 0 Then RefreshCustomerLookups
End Sub

Private Sub RefreshCustomerLookups()
    Dim response As Object: Set response = GetJson("/api/customer/lookups")
    Dim lookupSheet As Worksheet: Set lookupSheet = ThisWorkbook.Worksheets("_Lookups")
    Dim lastRow As Long
    lastRow = Application.Max(lookupSheet.Cells(lookupSheet.Rows.Count, "C").End(xlUp).Row, _
                              lookupSheet.Cells(lookupSheet.Rows.Count, "E").End(xlUp).Row)
    If lastRow >= 1 Then lookupSheet.Range("C1:F" & lastRow).ClearContents
    lookupSheet.Range("C1:F1").Value = Array("MarketID", "MarketCode", "CurrencyID", "CurrencyCode")
    Dim item As Variant, r As Long: r = 2
    For Each item In response("markets")
        lookupSheet.Cells(r, "C").Value = item("ID")
        lookupSheet.Cells(r, "D").Value = item("MarketCode")
        r = r + 1
    Next item
    r = 2
    For Each item In response("currencies")
        lookupSheet.Cells(r, "E").Value = item("ID")
        lookupSheet.Cells(r, "F").Value = item("CurrencyCode")
        r = r + 1
    Next item
    RefreshCustomerValidation ThisWorkbook.Worksheets("Customer")
End Sub

Private Function CustomerLookupID(ByVal lookupType As String, ByVal codeValue As Variant) As Variant
    Dim codeText As String: codeText = Trim$(CStr(codeValue & ""))
    If Len(codeText) = 0 Then Exit Function
    Dim idColumn As String, codeColumn As String
    If UCase$(lookupType) = "MARKET" Then
        idColumn = "C": codeColumn = "D"
    Else
        idColumn = "E": codeColumn = "F"
    End If
    Dim found As Range
    Set found = ThisWorkbook.Worksheets("_Lookups").Columns(codeColumn).Find( _
        What:=codeText, LookIn:=xlValues, LookAt:=xlWhole, MatchCase:=False)
    If Not found Is Nothing Then CustomerLookupID = ThisWorkbook.Worksheets("_Lookups").Cells(found.Row, idColumn).Value
End Function

Private Function UserMasterNullableText(ByVal value As Variant) As Variant
    If Len(Trim$(CStr(value & ""))) = 0 Then UserMasterNullableText = Null Else UserMasterNullableText = CStr(value)
End Function

Private Function UserMasterNullableLong(ByVal value As Variant) As Variant
    If Len(Trim$(CStr(value & ""))) = 0 Then UserMasterNullableLong = Null Else UserMasterNullableLong = CLng(value)
End Function

Private Function UserMasterNullableDouble(ByVal value As Variant) As Variant
    If Len(Trim$(CStr(value & ""))) = 0 Then UserMasterNullableDouble = Null Else UserMasterNullableDouble = CDbl(value)
End Function
