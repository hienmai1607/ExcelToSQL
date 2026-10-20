Attribute VB_Name = "modLocalDropdowns"
Option Explicit

Public Sub RefreshLocalDropdowns(ByVal data As Worksheet, ByVal response As Object)
    If Not response.Exists("dropdowns") Then Exit Sub
    Dim lists As Worksheet, key As Variant, items As Object, block() As Variant
    Dim c As Long, i As Long, destination As Long, last As Long, name As String, firstData As Long
    Dim keys As Range
    firstData = 3
    Set keys = data.Rows(2)
    If data.name = "Opportunity" Then
        firstData = 5
        Set keys = ThisWorkbook.Worksheets("_Config").Rows(10)
    End If
    On Error Resume Next
    Set lists = ThisWorkbook.Worksheets("_Lists")
    On Error GoTo 0
    If lists Is Nothing Then
        Set lists = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
        lists.name = "_Lists"
    End If
    lists.Cells.ClearContents
    last = data.Cells.Find(What:="*", After:=data.Cells(1, 1), LookIn:=xlFormulas, SearchOrder:=xlByColumns, SearchDirection:=xlPrevious).Column
    For Each key In response("dropdowns").Keys
        destination = 0
        For i = 1 To last
            If CStr(keys.Cells(1, i).Value2) = CStr(key) Then destination = i: Exit For
        Next i
        If destination > 0 Then
            data.Range(data.Cells(firstData, destination), data.Cells(data.Rows.Count, destination)).Validation.Delete
            Set items = response("dropdowns")(key)
            name = "PB_DD_" & CStr(key)
            On Error Resume Next
            ThisWorkbook.Names(name).Delete
            On Error GoTo 0
            If items.Count > 0 Then
                c = c + 1
                lists.Cells(1, c).Value2 = CStr(key)
                ReDim block(1 To items.Count, 1 To 1)
                For i = 1 To items.Count
                    block(i, 1) = CStr(items(i))
                Next i
                With lists.Cells(2, c).Resize(items.Count, 1)
                    .NumberFormat = "@"
                    .Value2 = block
                End With
                ThisWorkbook.Names.Add name:=name, RefersTo:="='_Lists'!" & lists.Cells(2, c).Resize(items.Count, 1).Address
                With data.Range(data.Cells(firstData, destination), data.Cells(data.Rows.Count, destination)).Validation
                    .Add Type:=xlValidateList, AlertStyle:=xlValidAlertStop, Formula1:="=" & name
                    .IgnoreBlank = True
                    .InCellDropdown = True
                    .ShowError = (CStr(key) <> "ParentType")
                    If CStr(key) = "ParentType" Then .InputMessage = "Choose one parent, or type parent names separated by semicolons."
                    .ErrorTitle = "Choose a listed value"
                    .ErrorMessage = "Refresh the workbook to obtain current choices."
                End With
            End If
        End If
    Next key
    lists.Visible = xlSheetVeryHidden
End Sub

Public Sub InitializeLocalRow(ByVal data As Worksheet, ByVal row As Long)
    Dim key As String, c As Long, last As Long
    last = data.Cells.Find(What:="*", After:=data.Cells(1, 1), LookIn:=xlFormulas, SearchOrder:=xlByColumns, SearchDirection:=xlPrevious).Column
    For c = 1 To last
        key = CStr(data.Cells(2, c).Value2)
        If InStr(1, "|Primary|Secondary|Tertiary|PrimaryMix|SecondaryMix|TertiaryMix|Palletization|Shipping|FinalComponent|", "|" & key & "|", vbBinaryCompare) > 0 Then data.Cells(row, c).Value2 = "False"
    Next c
End Sub
