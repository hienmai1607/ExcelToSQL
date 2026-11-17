Attribute VB_Name = "modAutoCompleteGuard"
Option Explicit
' Local Update sheets keep a hidden field-key row (Command, Status...) directly above the
' data, so Excel AutoComplete would propose those keys while typing (C -> "Command").
' AutoComplete is an Excel-wide option: switch it off only while this workbook is active
' and restore the user's own setting afterwards. The original value is stored in the
' user's VBA registry settings so a VBA reset or crash cannot lose it.
Private Const APP_NAME As String = "PythonBridge"
Private Const SECTION As String = "Excel"
Private Const KEY As String = "AutoCompleteBeforeLocalUpdate"

Public Sub SuspendAutoComplete()
    On Error Resume Next
    If Len(GetSetting(APP_NAME, SECTION, KEY, "")) = 0 Then
        SaveSetting APP_NAME, SECTION, KEY, IIf(Application.EnableAutoComplete, "True", "False")
    End If
    Application.EnableAutoComplete = False
    Err.Clear
End Sub

Public Sub RestoreAutoComplete()
    Dim previous As String
    On Error Resume Next
    previous = GetSetting(APP_NAME, SECTION, KEY, "")
    If Len(previous) > 0 Then
        Application.EnableAutoComplete = (previous = "True")
        DeleteSetting APP_NAME, SECTION
    End If
    Err.Clear
End Sub
