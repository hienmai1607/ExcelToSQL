Attribute VB_Name = "modUnifiedOpportunityBridge"
Option Explicit

' Unified grid: A Header Command, B Opportunity Number, C Customer Name,
' D Description, E Bid Open, F Bid Close, G Header Stage, H Item Command,
' I Product Code, J Item Description, K Annual Unit, L Award %, M Shelf
' Price, N Item Stage, O Status, P Message. Q:V are hidden keys:
' Header ID/RV, Item ID/RV, Customer ID, Product ID.
Public Sub ConfigureUnifiedOpportunity()
    Dim ws As Worksheet: Set ws = ThisWorkbook.Worksheets("Opportunity")
    On Error Resume Next: ws.Unprotect: On Error GoTo 0
    ConfigurePagination ws
    ws.Range("A1:V1").Value = Array("Header Command", "Opportunity Number", "Customer Name", "Opportunity Desc", "Bid Open", "Bid Close", "Header Stage", "Item Command", "Product Code", "Item Description", "Annual Unit", "Estimated % Awarded", "Shelf Price", "Item Stage", "Status", "Message", "Header ID", "Header RowVersion", "Item ID", "Item RowVersion", "Customer ID", "Product ID")
    ws.Columns("A:P").Hidden = False: ws.Columns("Q:V").Hidden = True
    SetList ws.Range("A2:A1000"), "C,U,D,N"
    SetList ws.Range("H2:H1000"), "C,U,D,N"
    On Error Resume Next
    ws.Range("G2:G1000").Validation.Delete
    ws.Range("N2:N1000").Validation.Delete
    On Error GoTo 0
    ws.Range("G2:G1000,N2:N1000").Interior.Color = RGB(217, 217, 217)
    ws.Range("W4:W6").Value = Application.Transpose(Array("Page", "Loaded", "Total Headers"))
    ws.Range("W8:W12").Value = Application.Transpose(Array("Opportunity Number", "Customer Name", "Header Stage", "Bid Open From", "Bid Open To"))
    If Val(ws.Range("X4").Value) < 1 Then ws.Range("X4").Value = 1
    ConfigureOpportunityLookupValidation ws
End Sub

Private Sub SetList(ByVal target As Range, ByVal values As String)
    target.Validation.Delete
    target.Validation.Add Type:=xlValidateList, Formula1:=values
End Sub

Public Sub RefreshUnifiedOpportunity(Optional ByVal direction As Long = 0)
    Dim ws As Worksheet: Set ws = ThisWorkbook.Worksheets("Opportunity")
    ConfigureUnifiedOpportunity
    If Not CanDiscardUnified(ws) Then Exit Sub
    On Error GoTo Failed
    RefreshOpportunityLookups
    Dim endpoint As String, page As Long
    endpoint = "/api/opportunity/grid?page_size=" & RowsPerPage(ws)
    If Len(Trim$(ws.Range("X8").Value & "")) > 0 Then endpoint = endpoint & "&opportunity_number=" & UrlEncode(CStr(ws.Range("X8").Value))
    If Len(Trim$(ws.Range("X9").Value & "")) > 0 Then endpoint = endpoint & "&customer_name=" & UrlEncode(CStr(ws.Range("X9").Value))
    If Len(Trim$(ws.Range("X10").Value & "")) > 0 Then endpoint = endpoint & "&stage=" & UrlEncode(CStr(ws.Range("X10").Value))
    If Len(Trim$(ws.Range("X11").Value & "")) > 0 Then endpoint = endpoint & "&bid_open_from=" & Format$(CDate(ws.Range("X11").Value), "yyyy-mm-dd")
    If Len(Trim$(ws.Range("X12").Value & "")) > 0 Then endpoint = endpoint & "&bid_open_to=" & Format$(CDate(ws.Range("X12").Value), "yyyy-mm-dd")
    page = RequestedPage(ws, direction, endpoint)
    Dim data As Object: Set data = GetJson(endpoint & "&page=" & page)
    If data("rows").Count = 0 And page > 1 Then
        page = Application.Max(1, -Int(-CLng(data("total")) / RowsPerPage(ws)))
        Set data = GetJson(endpoint & "&page=" & page)
    End If
    Dim lastRow As Long: lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
    If lastRow >= 2 Then ws.Range("A2:V" & lastRow).ClearContents
    Dim x As Variant, r As Long: r = 2
    For Each x In data("rows")
        ws.Cells(r, "A").Value = "N": ws.Cells(r, "H").Value = "N"
        ws.Cells(r, "B").Value = x("OpportunityNumber"): ws.Cells(r, "C").Value = x("CustomerName")
        ws.Cells(r, "D").Value = x("OpportunityDesc"): ws.Cells(r, "E").Value = x("BidOpen"): ws.Cells(r, "F").Value = x("BidClose"): ws.Cells(r, "G").Value = x("HeaderStage")
        ws.Cells(r, "I").Value = x("ProductCode"): ws.Cells(r, "J").Value = x("ItemDescription"): ws.Cells(r, "K").Value = x("AnnualUnit"): ws.Cells(r, "L").Value = x("EstPctAwarded"): ws.Cells(r, "M").Value = x("ShelfPrice"): ws.Cells(r, "N").Value = x("ItemStage")
        ws.Cells(r, "Q").Value = x("OpportunityID"): ws.Cells(r, "R").Value = x("HeaderRowVersion"): ws.Cells(r, "S").Value = x("ItemID"): ws.Cells(r, "T").Value = x("ItemRowVersion"): ws.Cells(r, "U").Value = x("CustomerID"): ws.Cells(r, "V").Value = x("ProductID")
        r = r + 1
    Next x
    CommitPage ws, page, data("rows").Count, CLng(data("total")), endpoint
    Exit Sub
Failed: MsgBox "Refresh failed: " & Err.Description, vbCritical
End Sub

Public Sub PreviousOpportunityPage()
    RefreshUnifiedOpportunity -1
End Sub

Public Sub NextOpportunityPage()
    RefreshUnifiedOpportunity 1
End Sub

Private Function OpportunityPage(ByVal ws As Worksheet) As Long
    OpportunityPage = CLng(Val(ws.Range("X4").Value))
    If OpportunityPage < 1 Then OpportunityPage = 1
End Function

Public Sub SaveUnifiedOpportunity()
    Dim ws As Worksheet: Set ws = ThisWorkbook.Worksheets("Opportunity")
    ConfigureUnifiedOpportunity
    On Error GoTo Failed
    EnsureOpportunityLookups
    Dim headerJson As String, itemJson As String, hc As Long, ic As Long
    headerJson = UnifiedHeaders(ws, hc): itemJson = UnifiedItems(ws, ic)
    If hc = 0 And ic = 0 Then MsgBox "No changed rows to save.", vbInformation: Exit Sub
    If Not ConfirmSaveMessage(OpportunityConfirmationMessage(ParseJson("[" & headerJson & "]"), ParseJson("[" & itemJson & "]"))) Then Exit Sub
    Dim response As Object: Set response = PostJson("/api/opportunity/batch", "{""header_rows"":[" & headerJson & "],""item_rows"":[" & itemJson & "]}")
    ApplyUnifiedResults ws, response("header_results"), True
    ApplyUnifiedResults ws, response("item_results"), False
    Exit Sub
Failed: MsgBox "Save failed: " & Err.Description, vbCritical
End Sub

Public Function OpportunityConfirmationMessage(ByVal headers As Object, ByVal items As Object) As String
    Dim hc As Long, hu As Long, hd As Long, ic As Long, iu As Long, id As Long, row As Variant
    For Each row In headers
        Select Case UCase$(CStr(row("Command")))
            Case "C": hc = hc + 1
            Case "U": hu = hu + 1
            Case "D": hd = hd + 1
        End Select
    Next row
    For Each row In items
        Select Case UCase$(CStr(row("Command")))
            Case "C": ic = ic + 1
            Case "U": iu = iu + 1
            Case "D": id = id + 1
        End Select
    Next row
    Dim details As String
    details = "Headers - Create: " & hc & ", Update: " & hu & ", Delete: " & hd & vbCrLf & _
              "Items - Create: " & ic & ", Update: " & iu & ", Delete: " & id
    OpportunityConfirmationMessage = BuildSaveConfirmation("Opportunity", hc + ic, hu + iu, hd + id, "Delete", details)
End Function

Private Function UnifiedHeaders(ws As Worksheet, ByRef count As Long) As String
    Dim seen As Object: Set seen = CreateObject("Scripting.Dictionary")
    Dim r As Long, lastRow As Long, cmd As String, key As String
    lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
    For r = 2 To lastRow
        cmd = UCase$(Trim$(ws.Cells(r, "A").Value & ""))
        If cmd <> "" And cmd <> "N" Then
            CheckCmd cmd, r: key = cmd & "|" & UCase$(Trim$(ws.Cells(r, "B").Value & ""))
            If cmd = "C" And Len(Trim$(ws.Cells(r, "G").Value & "")) = 0 Then ws.Cells(r, "G").Value = "Draft"
            If cmd = "C" And key = "C|" Then key = key & r
            If Not seen.Exists(key) Then
                If cmd = "C" Or cmd = "U" Then ws.Cells(r, "U").Value = CustomerId(ws.Cells(r, "C").Value)
                If cmd <> "C" Then NeedExisting ws, r, "Q", "R"
                If count > 0 Then UnifiedHeaders = UnifiedHeaders & ","
                UnifiedHeaders = UnifiedHeaders & "{""RowNum"":" & r & ",""Command"":" & JText(cmd) & ",""ID"":" & JInt(ws.Cells(r, "Q").Value) & ",""OpportunityNumber"":" & JText(ws.Cells(r, "B").Value) & ",""CustomerID"":" & JInt(ws.Cells(r, "U").Value) & ",""OpportunityDesc"":" & JText(ws.Cells(r, "D").Value) & ",""BidOpen"":" & JDate(ws.Cells(r, "E").Value) & ",""BidClose"":" & JDate(ws.Cells(r, "F").Value) & ",""RowVersion"":" & JText(ws.Cells(r, "R").Value) & "}"
                seen.Add key, True: count = count + 1
            End If
        End If
    Next r
End Function

Private Function UnifiedItems(ws As Worksheet, ByRef count As Long) As String
    Dim r As Long, lastRow As Long, cmd As String
    lastRow = ws.Cells(ws.Rows.Count, "H").End(xlUp).Row
    For r = 2 To lastRow
        cmd = UCase$(Trim$(ws.Cells(r, "H").Value & ""))
        If cmd <> "" And cmd <> "N" Then
            CheckCmd cmd, r
            If cmd = "C" And Len(Trim$(ws.Cells(r, "N").Value & "")) = 0 Then ws.Cells(r, "N").Value = "Draft"
            If Len(Trim$(ws.Cells(r, "B").Value & "")) = 0 Then Err.Raise vbObjectError + 2401, , "Row " & r & ": item needs Opportunity Number."
            If cmd = "C" Or cmd = "U" Then ws.Cells(r, "V").Value = ProductId(ws.Cells(r, "I").Value)
            If cmd <> "C" Then NeedExisting ws, r, "S", "T"
            If count > 0 Then UnifiedItems = UnifiedItems & ","
            UnifiedItems = UnifiedItems & "{""RowNum"":" & r & ",""Command"":" & JText(cmd) & ",""ID"":" & JInt(ws.Cells(r, "S").Value) & ",""OpportunityNumber"":" & JText(ws.Cells(r, "B").Value) & ",""ProductID"":" & JInt(ws.Cells(r, "V").Value) & ",""ItemDescription"":" & JText(ws.Cells(r, "J").Value) & ",""AnnualUnit"":" & JInt(ws.Cells(r, "K").Value) & ",""EstPctAwarded"":" & JDec(ws.Cells(r, "L").Value) & ",""ShelfPrice"":" & JDec(ws.Cells(r, "M").Value) & ",""RowVersion"":" & JText(ws.Cells(r, "T").Value) & "}"
            count = count + 1
        End If
    Next r
End Function

Private Sub ApplyUnifiedResults(ws As Worksheet, results As Object, isHeader As Boolean)
    Dim x As Variant, r As Long, oldNo As String, lastRow As Long, n As Long
    For Each x In results
        r = x("RowNum"): ws.Cells(r, "O").Value = x("Status"): ws.Cells(r, "P").Value = x("Message")
        If x("Status") = "OK" Then
            If isHeader Then
                oldNo = ws.Cells(r, "B").Value
                If Not IsNull(x("OpportunityNumber")) Then
                    lastRow = ws.Cells(ws.Rows.Count, "B").End(xlUp).Row
                    For n = 2 To lastRow: If StrComp(ws.Cells(n, "B").Value & "", oldNo, vbTextCompare) = 0 Then ws.Cells(n, "B").Value = x("OpportunityNumber"): ws.Cells(n, "G").Value = "Draft": ws.Cells(n, "Q").Value = x("NewID"): ws.Cells(n, "R").Value = x("NewRowVersion")
                    Next n
                End If
                ws.Cells(r, "A").Value = "N"
            Else
                ws.Cells(r, "N").Value = "Draft": ws.Cells(r, "S").Value = x("NewID"): ws.Cells(r, "T").Value = x("NewRowVersion"): ws.Cells(r, "H").Value = "N"
            End If
        End If
    Next x
End Sub

Private Function CanDiscardUnified(ws As Worksheet) As Boolean
    Dim r As Long, lastRow As Long
    lastRow = Application.Max(ws.Cells(ws.Rows.Count, "A").End(xlUp).Row, ws.Cells(ws.Rows.Count, "H").End(xlUp).Row)
    For r = 2 To lastRow
        If Not ShouldSkipRow(ws.Cells(r, "A").Value) Or Not ShouldSkipRow(ws.Cells(r, "H").Value) Then
            CanDiscardUnified = ConfirmDiscardChanges(ws.Name): Exit Function
        End If
    Next r
    CanDiscardUnified = True
End Function

Private Sub CheckCmd(cmd As String, r As Long)
    If cmd <> "C" And cmd <> "U" And cmd <> "D" Then Err.Raise vbObjectError + 2402, , "Row " & r & ": command must be C, U, D or N."
End Sub
Private Sub NeedExisting(ws As Worksheet, r As Long, idCol As String, rvCol As String)
    If Len(ws.Cells(r, idCol).Value & "") = 0 Or Len(ws.Cells(r, rvCol).Value & "") = 0 Then Err.Raise vbObjectError + 2403, , "Row " & r & ": update/delete needs ID and RowVersion."
End Sub
Private Function CustomerId(v As Variant) As Variant
    Dim f As Range: Set f = Sheets("_Lookups").Columns("H").Find(Trim$(v & ""), LookIn:=xlValues, LookAt:=xlWhole)
    If Not f Is Nothing Then CustomerId = Sheets("_Lookups").Cells(f.Row, "G").Value Else Err.Raise vbObjectError + 2404, , "Active Customer not found; refresh Opportunity."
End Function
Private Function ProductId(v As Variant) As Variant
    Dim f As Range: Set f = Sheets("_Lookups").Columns("B").Find(Trim$(v & ""), LookIn:=xlValues, LookAt:=xlWhole)
    If Not f Is Nothing Then ProductId = Sheets("_Lookups").Cells(f.Row, "A").Value Else Err.Raise vbObjectError + 2405, , "Active Product not found; refresh Opportunity."
End Function

Private Sub ConfigureOpportunityLookupValidation(ByVal ws As Worksheet)
    If ws.ProtectContents Then ws.Unprotect
    On Error Resume Next
    ThisWorkbook.Names("OpportunityProductCodes").Delete
    ThisWorkbook.Names("OpportunityCustomerNames").Delete
    On Error GoTo 0
    ThisWorkbook.Names.Add Name:="OpportunityProductCodes", RefersTo:="='_Lookups'!$B$2:INDEX('_Lookups'!$B:$B,MAX(2,COUNTA('_Lookups'!$B:$B)))"
    ThisWorkbook.Names.Add Name:="OpportunityCustomerNames", RefersTo:="='_Lookups'!$H$2:INDEX('_Lookups'!$H:$H,MAX(2,COUNTA('_Lookups'!$H:$H)))"
    On Error Resume Next
    ws.Range("C2:C1000").Validation.Delete
    ws.Range("I2:I1000").Validation.Delete
    On Error GoTo 0
    ws.Range("C2:C1000").Validation.Add Type:=xlValidateList, AlertStyle:=xlValidAlertStop, Formula1:="=OpportunityCustomerNames"
    ws.Range("I2:I1000").Validation.Add Type:=xlValidateList, AlertStyle:=xlValidAlertStop, Formula1:="=OpportunityProductCodes"
End Sub

Private Sub EnsureOpportunityLookups()
    If Len(Trim$(Sheets("_Lookups").Range("B2").Value & "")) = 0 Or _
       Len(Trim$(Sheets("_Lookups").Range("H2").Value & "")) = 0 Then RefreshOpportunityLookups
End Sub

Private Sub RefreshOpportunityLookups()
    Dim response As Object: Set response = GetJson("/api/opportunity/lookups")
    Dim ws As Worksheet: Set ws = ThisWorkbook.Worksheets("_Lookups")
    Dim lastRow As Long
    lastRow = Application.Max(ws.Cells(ws.Rows.Count, "A").End(xlUp).Row, ws.Cells(ws.Rows.Count, "G").End(xlUp).Row)
    If lastRow >= 1 Then
        ws.Range("A1:B" & lastRow).ClearContents
        ws.Range("G1:H" & lastRow).ClearContents
    End If
    ws.Range("A1:B1").Value = Array("ProductID", "ProductCode")
    ws.Range("G1:H1").Value = Array("CustomerID", "CustomerName")
    Dim item As Variant, r As Long: r = 2
    For Each item In response("products")
        ws.Cells(r, "A").Value = item("ID"): ws.Cells(r, "B").Value = item("ProductCode"): r = r + 1
    Next item
    r = 2
    For Each item In response("customers")
        ws.Cells(r, "G").Value = item("ID"): ws.Cells(r, "H").Value = item("CustomerName"): r = r + 1
    Next item
    ConfigureOpportunityLookupValidation ThisWorkbook.Worksheets("Opportunity")
End Sub
Private Function JText(v As Variant) As String
    If Len(Trim$(v & "")) = 0 Then JText = "null" Else JText = """" & Replace(Replace(Replace(v & "", "\", "\\"), """", "\"""), vbCrLf, "\n") & """"
End Function
Private Function JInt(v As Variant) As String
    If Len(Trim$(v & "")) = 0 Then JInt = "null" Else JInt = CStr(CLng(v))
End Function
Private Function JDec(v As Variant) As String
    If Len(Trim$(v & "")) = 0 Then JDec = "null" Else JDec = Replace(CStr(CDbl(v)), Application.International(xlDecimalSeparator), ".")
End Function
Private Function JDate(v As Variant) As String
    If Len(Trim$(v & "")) = 0 Then JDate = "null" Else JDate = JText(DateToIsoString(v))
End Function
