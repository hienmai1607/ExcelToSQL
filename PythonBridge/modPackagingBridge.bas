Attribute VB_Name = "modPackagingBridge"
Option Explicit

#If VBA7 Then
Private Declare PtrSafe Function CoCreateGuid Lib "ole32" (ByRef guid As Any) As Long
Private Declare PtrSafe Function StringFromGUID2 Lib "ole32" (ByRef guid As Any, ByVal buffer As LongPtr, ByVal size As Long) As Long
#Else
Private Declare Function CoCreateGuid Lib "ole32" (ByRef guid As Any) As Long
Private Declare Function StringFromGUID2 Lib "ole32" (ByRef guid As Any, ByVal buffer As Long, ByVal size As Long) As Long
#End If

Private mLookups As Object

Public Function PackagingHeaders(ByVal sheetName As String) As Variant
    Select Case sheetName
    Case "Packaging Material"
        PackagingHeaders = Split("Command|Material Code|Material Name|Description|Unit of Measure|Status|Created At|Created By|Updated At|Updated By|Result Status|Message|ID|RowVersion", "|")
    Case "Packaging Price"
        PackagingHeaders = Split("Command|Material Code|Currency|Price Basis|Quantity From|Quantity To|Unit Price|Effective From|Effective To|Status|Created At|Created By|Updated At|Updated By|Result Status|Message|ID|Material ID|Currency ID|RowVersion", "|")
    Case "Packaging Request"
        PackagingHeaders = Split("Command|Request Number|Requested By|Requested At|Response Due|Request Status|Opportunity Number|Customer Name|Opportunity Description|Product Code|Product Name|Item Description|Annual Units|Packaging Requirement|PIC|Item Status|Material Code|Height (mm)|Width (mm)|Length (mm)|Cost|Currency|Cost Basis|Response Notes|Manager Comment|Result Status|Message|Request ID|Request Item ID|Opportunity ID|Opportunity Item ID|Material ID|Price ID|PIC User ID|Header RowVersion|Item RowVersion|Copied From Response ID", "|")
    Case "Packaging History"
        PackagingHeaders = Split("Request Number|Opportunity Number|Customer Name|Product Code|Product Name|Item Description|Material Code|Height (mm)|Width (mm)|Length (mm)|Cost|Currency|Cost Basis|PIC|Approved By|Approved At|Response Notes|Request ID|Request Item ID|Response Version ID", "|")
    Case "Manual Request"
        PackagingHeaders = Split("Command|Opportunity Number|Customer Name|Opportunity Description|Bid Open|Bid Close|Product Code|Product Name|Item Description|Annual Units|Response Due|Packaging Requirement|Request Notes|Created Request Number|Result Status|Message|Opportunity ID|Opportunity Item ID|Header RowVersion|Item RowVersion|Creation Key", "|")
    Case Else
        Err.Raise vbObjectError + 2800, , "Unknown Packaging sheet."
    End Select
End Function

Private Function FieldKeys(ByVal sheetName As String) As Variant
    Select Case sheetName
    Case "Packaging Material"
        FieldKeys = Split("Command|MaterialCode|MaterialName|Description|UnitOfMeasure|Status|CreatedAt|CreatedBy|UpdatedAt|UpdatedBy|ResultStatus|Message|ID|RowVersion", "|")
    Case "Packaging Price"
        FieldKeys = Split("Command|MaterialCode|CurrencyCode|PriceBasis|QuantityFrom|QuantityTo|UnitPrice|EffectiveFrom|EffectiveTo|Status|CreatedAt|CreatedBy|UpdatedAt|UpdatedBy|ResultStatus|Message|ID|MaterialID|CurrencyID|RowVersion", "|")
    Case "Packaging Request"
        FieldKeys = Split("Command|RequestNumber|RequestedByName|RequestedAt|ResponseDue|RequestStatus|OpportunityNumber|CustomerName|OpportunityDescription|ProductCode|ProductName|ItemDescription|AnnualUnit|PackagingRequirement|PIC|ItemStage|MaterialCode|HeightMM|WidthMM|LengthMM|Cost|CurrencyCode|CostBasis|ResponseNotes|ManagerComment|ResultStatus|Message|RequestID|ItemID|OpportunityID|OpportunityItemID|MaterialID|PriceID|PICUserID|HeaderRowVersion|ItemRowVersion|CopiedFromResponseID", "|")
    Case "Packaging History"
        FieldKeys = Split("RequestNumber|OpportunityNumber|CustomerName|ProductCode|ProductName|ItemDescription|MaterialCode|HeightMM|WidthMM|LengthMM|Cost|CurrencyCode|CostBasis|PIC|ReviewedBy|ReviewedAt|ResponseNotes|RequestID|ItemID|ResponseVersionID", "|")
    Case "Manual Request"
        FieldKeys = Split("Command|OpportunityNumber|CustomerName|OpportunityDescription|BidOpen|BidClose|ProductCode|ProductName|ItemDescription|AnnualUnit|ResponseDue|PackagingRequirement|RequestNotes|CreatedRequestNumber|ResultStatus|Message|OpportunityID|OpportunityItemID|HeaderRowVersion|ItemRowVersion|CreationKey", "|")
    End Select
End Function

Public Function PackagingHiddenStart(ByVal sheetName As String) As Long
    Select Case sheetName
    Case "Packaging Material": PackagingHiddenStart = 13
    Case "Packaging Price": PackagingHiddenStart = 17
    Case "Packaging Request": PackagingHiddenStart = 28
    Case "Packaging History": PackagingHiddenStart = 18
    Case "Manual Request": PackagingHiddenStart = 17
    End Select
End Function

Private Function CellAt(ByVal ws As Worksheet, ByVal rowIndex As Long, ByVal header As String) As Range
    Set CellAt = ws.ListObjects(1).DataBodyRange.Cells(rowIndex, ws.ListObjects(1).ListColumns(header).Index)
End Function

Private Function TextAt(ByVal ws As Worksheet, ByVal rowIndex As Long, ByVal header As String) As String
    TextAt = Trim$(CStr(CellAt(ws, rowIndex, header).Value2 & ""))
End Function

Private Function NullableText(ByVal value As Variant) As Variant
    If Len(Trim$(CStr(value & ""))) = 0 Then
        NullableText = Null
    Else
        NullableText = CStr(value)
    End If
End Function

Private Function NumericValue(ByVal value As Variant) As Variant
    If Len(Trim$(CStr(value & ""))) = 0 Then
        NumericValue = Null
    ElseIf Not IsNumeric(value) Then
        Err.Raise vbObjectError + 2801, , "A numeric field contains non-numeric text."
    Else
        NumericValue = CDbl(value)
    End If
End Function

Private Function LookupID(ByVal listName As String, ByVal codeField As String, ByVal code As String) As Variant
    If Len(code) = 0 Then LookupID = Null: Exit Function
    Dim item As Variant
    For Each item In mLookups(listName)
        If StrComp(CStr(item(codeField)), code, vbTextCompare) = 0 Then
            LookupID = CLng(item("ID")): Exit Function
        End If
    Next item
    Err.Raise vbObjectError + 2802, , codeField & " not found: " & code & ". Refresh first."
End Function

Private Function DirtyCount(ByVal ws As Worksheet) As Long
    If ws.Name = "Packaging History" Then Exit Function
    Dim rowIndex As Long, commandText As String
    For rowIndex = 1 To ws.ListObjects(1).ListRows.Count
        commandText = UCase$(TextAt(ws, rowIndex, "Command"))
        If commandText <> "" And commandText <> "N" Then DirtyCount = DirtyCount + 1
    Next rowIndex
End Function

Public Function PackagingPageSize(ByVal ws As Worksheet) As Long
    PackagingPageSize = RowsPerPage(ws)
End Function

Private Function PageURL(ByVal ws As Worksheet, ByVal page As Long, ByVal size As Long) As String
    Dim endpoint As String, filter As String
    filter = UrlEncode(Trim$(CStr(ws.Range("BB8").Value2 & "")))
    Select Case ws.Name
    Case "Packaging Material": endpoint = "/material?search=" & filter
    Case "Packaging Price": endpoint = "/price?unused=1"
    Case "Packaging Request": endpoint = "/requests?opportunity_number=" & filter
    Case "Packaging History": endpoint = "/requests?stage=Approved&opportunity_number=" & filter
    Case "Manual Request": endpoint = "/manual?opportunity_number=" & filter
    End Select
    PageURL = "/api/packaging" & endpoint & "&page=" & page & "&page_size=" & size
End Function

Public Sub PackagingRefresh()
    RefreshPage ActiveSheet, 0
End Sub

Public Sub PackagingPrevious()
    RefreshPage ActiveSheet, -1
End Sub

Public Sub PackagingNext()
    RefreshPage ActiveSheet, 1
End Sub

Private Sub RefreshPage(ByVal ws As Worksheet, ByVal delta As Long)
    On Error GoTo Failed
    Dim size As Long, page As Long, signature As String, response As Object
    size = PackagingPageSize(ws)
    signature = CStr(ws.Range("BB8").Value2)
    page = RequestedPage(ws, delta, signature)
    If DirtyCount(ws) > 0 Then
        If Not ConfirmDiscardChanges(ws.Name) Then Exit Sub
    End If
    Set response = GetJson(PageURL(ws, page, size))
    If response("rows").Count = 0 And page > 1 Then
        MsgBox "No rows on that page. Current rows have been kept.", vbInformation
        Exit Sub
    End If
    RenderPage ws, response("rows")
    CommitPage ws, page, response("rows").Count, CLng(response("total")), signature
    Exit Sub
Failed:
    MsgBox "Refresh failed: " & Err.Description, vbCritical
End Sub

Public Sub RenderPage(ByVal ws As Worksheet, ByVal rows As Object)
    Dim keys As Variant: keys = FieldKeys(ws.Name)
    Dim count As Long: count = rows.Count
    Dim output() As Variant, r As Long, c As Long, item As Object, value As Variant
    ReDim output(1 To IIf(count = 0, 1, count), 1 To UBound(keys) + 1)
    For r = 1 To count
        Set item = rows(r)
        For c = 0 To UBound(keys)
            If keys(c) = "Command" Then
                output(r, c + 1) = "N"
            ElseIf item.Exists(keys(c)) Then
                value = item(keys(c))
                If Not IsNull(value) Then
                    If keys(c) = "ResponseDue" Or keys(c) = "EffectiveFrom" Or keys(c) = "EffectiveTo" Or keys(c) = "BidOpen" Or keys(c) = "BidClose" Then
                        If Len(CStr(value)) >= 10 Then value = DateSerial(CInt(Left$(value, 4)), CInt(Mid$(value, 6, 2)), CInt(Mid$(value, 9, 2)))
                    End If
                    output(r, c + 1) = value
                End If
            End If
        Next c
    Next r
    Dim table As ListObject: Set table = ws.ListObjects(1)
    If ws.FilterMode Then ws.ShowAllData
    If Not table.DataBodyRange Is Nothing Then table.DataBodyRange.ClearContents
    table.Resize ws.Range(ws.Cells(1, 1), ws.Cells(UBound(output, 1) + 1, UBound(output, 2)))
    If table.DataBodyRange Is Nothing Then table.ListRows.Add
    table.DataBodyRange.Value = output
    ws.Range(ws.Columns(PackagingHiddenStart(ws.Name)), ws.Columns(UBound(keys) + 1)).EntireColumn.Hidden = True
End Sub

Private Function BuildRow(ByVal ws As Worksheet, ByVal rowIndex As Long, ByVal commandText As String) As Object
    Dim row As Object: Set row = CreateObject("Scripting.Dictionary")
    Dim fields As Variant, field As Variant, parts As Variant, value As Variant
    row.Add "RowNum", rowIndex
    If ws.Name = "Packaging Request" Then
        If commandText <> "U" Then Err.Raise vbObjectError + 2805, , "Request responses allow U only. Use Manual Request to create requests."
        row.Add "ID", NumericValue(CellAt(ws, rowIndex, "Request Item ID").Value2)
        row.Add "RowVersion", TextAt(ws, rowIndex, "Item RowVersion")
        fields = Split("MaterialID:Material Code|HeightMM:Height (mm)|WidthMM:Width (mm)|LengthMM:Length (mm)|Cost:Cost|CurrencyID:Currency|CostBasis:Cost Basis|ResponseNotes:Response Notes", "|")
    Else
        If commandText <> "C" And commandText <> "U" And commandText <> "D" Then Err.Raise vbObjectError + 2805, , "Command must be C, U, D or N."
        row.Add "Command", commandText
        If commandText = "C" Then
            If Len(TextAt(ws, rowIndex, "ID")) > 0 Then Err.Raise vbObjectError + 2805, , "Create requires a new row without an ID."
            row.Add "ID", Null: row.Add "RowVersion", Null
        Else
            row.Add "ID", NumericValue(CellAt(ws, rowIndex, "ID").Value2)
            row.Add "RowVersion", TextAt(ws, rowIndex, "RowVersion")
        End If
        If commandText = "D" Then Set BuildRow = row: Exit Function
        If ws.Name = "Packaging Material" Then
            fields = Split("MaterialCode:Material Code|MaterialName:Material Name|Description:Description|UnitOfMeasure:Unit of Measure|Status:Status", "|")
        Else
            fields = Split("MaterialID:Material Code|CurrencyID:Currency|PriceBasis:Price Basis|QuantityFrom:Quantity From|QuantityTo:Quantity To|UnitPrice:Unit Price|EffectiveFrom:Effective From|EffectiveTo:Effective To|Status:Status", "|")
        End If
    End If
    For Each field In fields
        parts = Split(field, ":")
        value = CellAt(ws, rowIndex, CStr(parts(1))).Value2
        Select Case parts(0)
        Case "MaterialID": value = LookupID("materials", "MaterialCode", Trim$(CStr(value & "")))
        Case "CurrencyID": value = LookupID("currencies", "CurrencyCode", Trim$(CStr(value & "")))
        Case "HeightMM", "WidthMM", "LengthMM", "Cost", "QuantityFrom", "QuantityTo", "UnitPrice": value = NumericValue(value)
        Case "EffectiveFrom", "EffectiveTo": value = DateToIsoString(value)
        Case Else: value = NullableText(value)
        End Select
        row.Add CStr(parts(0)), value
    Next field
    Set BuildRow = row
End Function

Private Sub ApplyResults(ByVal ws As Worksheet, ByVal results As Object)
    Dim result As Variant, rowIndex As Long, found As Long, idHeader As String, rvHeader As String
    idHeader = "ID": rvHeader = "RowVersion"
    If ws.Name = "Packaging Request" Then idHeader = "Request Item ID": rvHeader = "Item RowVersion"
    For Each result In results
        rowIndex = CLng(result("RowNum"))
        ' Existing rows are resolved by immutable ID, so full-table sorting is safe.
        If Len(TextAt(ws, rowIndex, idHeader)) > 0 And Not IsNull(result("NewID")) Then
            found = 0
            Dim scan As Long
            For scan = 1 To ws.ListObjects(1).ListRows.Count
                If TextAt(ws, scan, idHeader) = CStr(result("NewID")) Then found = scan: Exit For
            Next scan
            If found > 0 Then rowIndex = found
        End If
        CellAt(ws, rowIndex, "Result Status").Value2 = result("Status")
        CellAt(ws, rowIndex, "Message").Value2 = result("Message")
        If result("Status") = "OK" Then
            CellAt(ws, rowIndex, idHeader).Value2 = result("NewID")
            CellAt(ws, rowIndex, rvHeader).Value2 = result("NewRowVersion")
            If ws.Name <> "Packaging Request" And UCase$(TextAt(ws, rowIndex, "Command")) = "D" Then CellAt(ws, rowIndex, "Status").Value2 = "Block"
            CellAt(ws, rowIndex, "Command").Value2 = "N"
        End If
    Next result
End Sub

Public Function PackagingConfirmationMessage(ByVal ws As Worksheet) As String
    Dim allowed As String, details As String, table As ListObject
    Set table = ws.ListObjects(1)
    allowed = "CUD"
    If ws.Name = "Packaging Request" Then allowed = "U"
    If ws.Name = "Manual Request" Then
        allowed = "C"
        Dim groups As Object: Set groups = CreateObject("Scripting.Dictionary")
        Dim r As Long, opportunity As String
        For r = 1 To table.ListRows.Count
            If UCase$(TextAt(ws, r, "Command")) = "C" Then
                opportunity = TextAt(ws, r, "Opportunity ID")
                If Len(opportunity) > 0 Then groups(opportunity) = True
            End If
        Next r
        details = "Requests: " & groups.Count & vbCrLf & "Create count represents selected items, grouped by Opportunity."
    End If
    PackagingConfirmationMessage = CommandConfirmationMessage(ws, ws.Name, table.ListColumns("Command").Range.Column, _
        table.HeaderRowRange.Row + 1, table.HeaderRowRange.Row + table.ListRows.Count, "Block", allowed, details)
End Function

Public Sub PackagingSave()
    On Error GoTo Failed
    Dim ws As Worksheet: Set ws = ActiveSheet
    If ws.Name = "Packaging History" Then MsgBox "Approved records are reference-only. There are no editable responses on this sheet.", vbInformation: Exit Sub
    If Not ConfirmSaveMessage(PackagingConfirmationMessage(ws)) Then Exit Sub
    If ws.Name = "Manual Request" Then SaveManual ws: Exit Sub
    If ws.Name <> "Packaging Material" Then Set mLookups = GetJson("/api/packaging/lookups")
    Dim rows As New Collection, rowIndex As Long, commandText As String, payload As Object, response As Object
    Dim endpoint As String
    Select Case ws.Name
    Case "Packaging Material": endpoint = "/material/batch"
    Case "Packaging Price": endpoint = "/price/batch"
    Case "Packaging Request": endpoint = "/response/batch"
    End Select
    ' Validate the entire visible and filtered table before the first write.
    For rowIndex = 1 To ws.ListObjects(1).ListRows.Count
        commandText = UCase$(TextAt(ws, rowIndex, "Command"))
        If commandText <> "" And commandText <> "N" Then rows.Add BuildRow(ws, rowIndex, commandText)
    Next rowIndex
    Dim batch As Collection, index As Long, last As Long, failures As Long, result As Variant
    For index = 1 To rows.Count Step 500
        Set batch = New Collection
        last = index + 499: If last > rows.Count Then last = rows.Count
        For rowIndex = index To last: batch.Add rows(rowIndex): Next rowIndex
        Set payload = CreateObject("Scripting.Dictionary"): payload.Add "rows", batch
        Set response = PostJson("/api/packaging" & endpoint, ConvertToJson(payload))
        ApplyResults ws, response("results")
        For Each result In response("results")
            If result("Status") <> "OK" Then failures = failures + 1
        Next result
    Next index
    MsgBox rows.Count & " row(s) processed; " & failures & " rejected. Review Result Status and Message.", vbInformation
    Exit Sub
Failed:
    MsgBox "Save failed: " & Err.Description & vbCrLf & "Unsaved commands are retained. Earlier successful batches, if any, are marked N.", vbCritical
End Sub

Private Function NewGuid() As String
    Dim bytes(0 To 15) As Byte, buffer As String
    If CoCreateGuid(bytes(0)) <> 0 Then Err.Raise vbObjectError + 2806, , "Cannot generate request key."
    buffer = String$(39, vbNullChar)
    If StringFromGUID2(bytes(0), StrPtr(buffer), 39) = 0 Then Err.Raise vbObjectError + 2806, , "Cannot format request key."
    NewGuid = Mid$(buffer, 2, 36)
End Function

Private Sub SaveManual(ByVal ws As Worksheet)
    Dim groups As Object: Set groups = CreateObject("Scripting.Dictionary")
    Dim rowIndex As Long, key As Variant, group As Object, selection As Object, selected As Collection
    Dim commandText As String, opportunity As String, due As Variant, notes As Variant, creationKey As String
    For rowIndex = 1 To ws.ListObjects(1).ListRows.Count
        commandText = UCase$(TextAt(ws, rowIndex, "Command"))
        If commandText <> "" And commandText <> "N" Then
            If commandText <> "C" Then Err.Raise vbObjectError + 2807, , "Manual Request accepts C only."
            opportunity = TextAt(ws, rowIndex, "Opportunity ID")
            If Len(opportunity) = 0 Or Len(TextAt(ws, rowIndex, "Opportunity Item ID")) = 0 Then Err.Raise vbObjectError + 2807, , "Refresh Manual Request and select existing Opportunity rows."
            due = DateToIsoString(CellAt(ws, rowIndex, "Response Due").Value2)
            If IsNull(due) Then Err.Raise vbObjectError + 2807, , "Response Due is required on every selected row."
            notes = NullableText(CellAt(ws, rowIndex, "Request Notes").Value2)
            If Not groups.Exists(opportunity) Then
                Set group = CreateObject("Scripting.Dictionary")
                group.Add "OpportunityID", CLng(opportunity)
                group.Add "ExpectedRowVersion", TextAt(ws, rowIndex, "Header RowVersion")
                group.Add "ResponseDue", due
                group.Add "RequestNotes", notes
                creationKey = TextAt(ws, rowIndex, "Creation Key")
                If Len(creationKey) = 0 Then creationKey = NewGuid()
                group.Add "CreationKey", creationKey
                Set selected = New Collection: group.Add "items", selected
                groups.Add opportunity, group
            Else
                Set group = groups(opportunity)
                If CStr(group("ResponseDue")) <> CStr(due) Or CStr(group("RequestNotes") & "") <> CStr(notes & "") Then Err.Raise vbObjectError + 2808, , "Selected rows of one Opportunity must have the same Response Due and Request Notes."
                If group("ExpectedRowVersion") <> TextAt(ws, rowIndex, "Header RowVersion") Then Err.Raise vbObjectError + 2808, , "Conflicting header RowVersions; refresh."
                creationKey = TextAt(ws, rowIndex, "Creation Key")
                If Len(creationKey) > 0 And creationKey <> group("CreationKey") Then Err.Raise vbObjectError + 2808, , "Conflicting creation keys. Reconcile previous requests before making a new selection."
            End If
            Set selection = CreateObject("Scripting.Dictionary")
            selection.Add "OpportunityItemID", CLng(TextAt(ws, rowIndex, "Opportunity Item ID"))
            selection.Add "ExpectedRowVersion", TextAt(ws, rowIndex, "Item RowVersion")
            selection.Add "PackagingRequirement", NullableText(CellAt(ws, rowIndex, "Packaging Requirement").Value2)
            group("items").Add selection
        End If
    Next rowIndex
    ' Persist retry keys BEFORE sending. An ambiguous failure keeps C and the same key.
    For rowIndex = 1 To ws.ListObjects(1).ListRows.Count
        If UCase$(TextAt(ws, rowIndex, "Command")) = "C" Then
            CellAt(ws, rowIndex, "Creation Key").Value2 = groups(TextAt(ws, rowIndex, "Opportunity ID"))("CreationKey")
        End If
    Next rowIndex
    ThisWorkbook.Save
    Dim response As Object, created As Long
    For Each key In groups.Keys
        Set group = groups(key)
        Set response = PostJson("/api/packaging/manual", ConvertToJson(group))
        For rowIndex = 1 To ws.ListObjects(1).ListRows.Count
            If UCase$(TextAt(ws, rowIndex, "Command")) = "C" And TextAt(ws, rowIndex, "Opportunity ID") = CStr(key) Then
                CellAt(ws, rowIndex, "Created Request Number").Value2 = response("header")("RequestNumber")
                CellAt(ws, rowIndex, "Result Status").Value2 = "OK"
                CellAt(ws, rowIndex, "Message").Value2 = "Request created. Refresh Packaging Request to view."
                CellAt(ws, rowIndex, "Command").Value2 = "N"
            End If
        Next rowIndex
        created = created + 1
        ThisWorkbook.Save
    Next key
    MsgBox created & " request(s) created. Refresh Packaging Request to view them.", vbInformation
End Sub
