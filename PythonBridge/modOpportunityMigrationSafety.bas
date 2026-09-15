Attribute VB_Name = "modOpportunityMigrationSafety"
Option Explicit

' Keep the Header and Items sheets coherent after the API turns a
' client-side placeholder such as NEW1 into a generated OPP-YYYY-#####.
' Only unsaved item rows are rewritten: existing records must retain their
' server-issued number and an accidental placeholder match must not alter
' them.
Public Sub PropagateGeneratedOpportunityNumber(ByVal previousNumber As String, ByVal generatedNumber As String)
    Dim oldValue As String: oldValue = Trim$(previousNumber)
    Dim newValue As String: newValue = Trim$(generatedNumber)
    If Len(oldValue) = 0 Or Len(newValue) = 0 Then Exit Sub
    If StrComp(oldValue, newValue, vbTextCompare) = 0 Then Exit Sub

    Dim itemsWs As Worksheet
    Set itemsWs = ThisWorkbook.Worksheets("Opportunity Items")

    Dim lastRow As Long
    lastRow = itemsWs.Cells(itemsWs.Rows.Count, "A").End(xlUp).Row

    Dim rowNumber As Long
    For rowNumber = 2 To lastRow
        If UCase$(Trim$(CStr(itemsWs.Cells(rowNumber, "A").Value & ""))) = "C" Then
            If StrComp(Trim$(CStr(itemsWs.Cells(rowNumber, "C").Value & "")), oldValue, vbTextCompare) = 0 Then
                itemsWs.Cells(rowNumber, "C").Value = newValue
            End If
        End If
    Next rowNumber

    ' The load filter is often pre-filled with the same placeholder.
    If StrComp(Trim$(CStr(itemsWs.Range("P2").Value & "")), oldValue, vbTextCompare) = 0 Then
        itemsWs.Range("P2").Value = newValue
    End If
End Sub
