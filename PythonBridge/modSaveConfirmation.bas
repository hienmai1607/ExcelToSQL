Attribute VB_Name = "modSaveConfirmation"
Option Explicit

Public Function BuildSaveConfirmation(ByVal entity As String, ByVal creates As Long, ByVal updates As Long, ByVal deletes As Long, Optional ByVal deleteLabel As String = "Delete", Optional ByVal details As String = "") As String
    If creates + updates + deletes = 0 Then Exit Function
    BuildSaveConfirmation = "Confirm " & entity & " changes:" & vbCrLf & vbCrLf & _
        "Create: " & creates & vbCrLf & "Update: " & updates & vbCrLf & deleteLabel & ": " & deletes
    If Len(details) > 0 Then BuildSaveConfirmation = BuildSaveConfirmation & vbCrLf & vbCrLf & details
    If deletes > 0 And deleteLabel = "Delete" Then BuildSaveConfirmation = BuildSaveConfirmation & vbCrLf & vbCrLf & "Delete is permanent."
    BuildSaveConfirmation = BuildSaveConfirmation & vbCrLf & vbCrLf & "Includes changed rows hidden by filters." & vbCrLf & "Continue with Save?"
End Function

Public Function ConfirmSaveMessage(ByVal message As String) As Boolean
    If Len(message) = 0 Then
        MsgBox "No changed rows to save.", vbInformation, "Save"
        Exit Function
    End If
    ConfirmSaveMessage = (MsgBox(message, vbYesNo + vbQuestion + vbDefaultButton2, "Confirm Save") = vbYes)
End Function

Public Function ConfirmDiscardChanges(ByVal entity As String) As Boolean
    ConfirmDiscardChanges = (MsgBox("Refresh " & entity & "?" & vbCrLf & vbCrLf & _
        "Unsaved changes, including rows hidden by filters, will be discarded." & vbCrLf & _
        "Continue?", vbYesNo + vbExclamation + vbDefaultButton2, "Confirm Refresh") = vbYes)
End Function

Public Function CommandConfirmationMessage(ByVal ws As Worksheet, ByVal entity As String, ByVal commandColumn As Long, ByVal firstRow As Long, ByVal lastRow As Long, Optional ByVal deleteLabel As String = "Delete", Optional ByVal allowedCommands As String = "CUD", Optional ByVal details As String = "") As String
    Dim r As Long, cmd As String, creates As Long, updates As Long, deletes As Long
    For r = firstRow To lastRow
        cmd = UCase$(Trim$(CStr(ws.Cells(r, commandColumn).Value2 & "")))
        If cmd <> "" And cmd <> "N" Then
            If Len(cmd) <> 1 Or InStr(1, allowedCommands, cmd, vbBinaryCompare) = 0 Then _
                Err.Raise vbObjectError + 2850, , "Row " & r & ": invalid Command. Allowed: " & allowedCommands & " or N."
            Select Case cmd
                Case "C": creates = creates + 1
                Case "U": updates = updates + 1
                Case "D": deletes = deletes + 1
            End Select
        End If
    Next r
    CommandConfirmationMessage = BuildSaveConfirmation(entity, creates, updates, deletes, deleteLabel, details)
End Function

