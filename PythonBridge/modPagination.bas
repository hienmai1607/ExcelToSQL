Attribute VB_Name = "modPagination"
Option Explicit

Private mLoadedSignatures As Object

Private Function PagingCells(ByVal ws As Worksheet) As Variant
    Select Case ws.Name
        Case "Market", "Currency", "Users", "User Access", "Product"
            PagingCells = Array("N8", "N4", "N5", "N6")
        Case "Customer": PagingCells = Array("M9", "M5", "M6", "M7")
        Case "Opportunity": PagingCells = Array("X7", "X4", "X5", "X6")
        Case Else: PagingCells = Array("BB4", "BB5", "BB7", "BB6")
    End Select
End Function

Public Sub ConfigurePagination(ByVal ws As Worksheet)
    Dim cells As Variant: cells = PagingCells(ws)
    Dim target As Range: Set target = ws.Range(cells(0))
    If Len(CStr(target.Value2 & "")) = 0 Then target.Value2 = 200
    target.Offset(0, -1).Value2 = IIf(ws.Name = "Opportunity", "Headers per page", "Rows per page")
    target.NumberFormat = "0"
    target.Interior.Color = RGB(255, 255, 204)
    With target.Validation
        .Delete
        .Add Type:=xlValidateWholeNumber, AlertStyle:=xlValidAlertStop, Operator:=xlBetween, Formula1:="1", Formula2:="500"
        .IgnoreBlank = False
        .ShowError = True
        .ErrorMessage = "Enter a whole number from 1 to 500."
    End With
End Sub

Public Function RowsPerPage(ByVal ws As Worksheet) As Long
    Dim cells As Variant: cells = PagingCells(ws)
    Dim value As Variant: value = ws.Range(cells(0)).Value2
    If IsError(value) Then GoTo Invalid
    If Not IsNumeric(value) Then GoTo Invalid
    If CDbl(value) < 1 Or CDbl(value) > 500 Then GoTo Invalid
    If CDbl(value) <> Fix(CDbl(value)) Then GoTo Invalid
    RowsPerPage = CLng(value)
    Exit Function
Invalid:
    Err.Raise vbObjectError + 2860, , "Rows per page must be a whole number from 1 to 500."
End Function

Private Function PagingKey(ByVal ws As Worksheet) As String
    PagingKey = ws.Parent.FullName & "|" & ws.CodeName
End Function

Public Function RequestedPage(ByVal ws As Worksheet, ByVal direction As Long, Optional ByVal filters As String = "") As Long
    Dim size As Long: size = RowsPerPage(ws)
    Dim signature As String: signature = CStr(size) & "|" & filters
    RequestedPage = 1
    If direction = 0 Then Exit Function
    If mLoadedSignatures Is Nothing Then Exit Function
    If Not mLoadedSignatures.Exists(PagingKey(ws)) Then Exit Function
    If mLoadedSignatures(PagingKey(ws)) <> signature Then Exit Function
    Dim cells As Variant: cells = PagingCells(ws)
    Dim page As Double: page = Val(CStr(ws.Range(cells(1)).Value2))
    If page < 1 Or page <> Fix(page) Or page > 2147483646# Then Err.Raise vbObjectError + 2861, , "Refresh to restore the current page."
    Dim lastPage As Double: lastPage = Application.Max(1, -Int(-Val(CStr(ws.Range(cells(3)).Value2)) / size))
    RequestedPage = CLng(Application.Max(1, Application.Min(lastPage, page + direction)))
End Function

Public Sub CommitPage(ByVal ws As Worksheet, ByVal page As Long, ByVal loaded As Long, ByVal total As Long, Optional ByVal filters As String = "")
    Dim cells As Variant: cells = PagingCells(ws)
    ws.Range(cells(1)).Value2 = page
    ws.Range(cells(2)).Value2 = loaded
    ws.Range(cells(3)).Value2 = total
    If mLoadedSignatures Is Nothing Then Set mLoadedSignatures = CreateObject("Scripting.Dictionary")
    mLoadedSignatures(PagingKey(ws)) = CStr(RowsPerPage(ws)) & "|" & filters
End Sub
