Attribute VB_Name = "modHttpJson"
Option Explicit

Private Const DEFAULT_API_BASE_URL As String = "http://127.0.0.1:8000"
Private Const CONNECT_TIMEOUT_MS As Long = 5000
Private Const SEND_TIMEOUT_MS As Long = 15000
Private Const RECEIVE_TIMEOUT_MS As Long = 60000
Private Const REQUIRED_CONTRACT_VERSION As String = "2"

Private Function ApiBaseUrl() As String
    Dim configured As String: configured = Trim$(Environ$("PYTHON_BRIDGE_URL"))
    If Len(configured) = 0 Then configured = DEFAULT_API_BASE_URL
    If Right$(configured, 1) = "/" Then configured = Left$(configured, Len(configured) - 1)
    ApiBaseUrl = configured
End Function

Private Function NewHttpRequest(ByVal method As String, ByVal endpoint As String) As Object
    Dim http As Object: Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
    http.SetTimeouts CONNECT_TIMEOUT_MS, CONNECT_TIMEOUT_MS, SEND_TIMEOUT_MS, RECEIVE_TIMEOUT_MS
    http.SetAutoLogonPolicy 0
    http.Open method, ApiBaseUrl() & endpoint, False
    http.SetRequestHeader "X-Request-ID", NewRequestID()
    ' The API server owns AUTH_MODE. Sending the workstation username on every
    ' request lets development_header identify the Excel user without requiring
    ' duplicate configuration on every laptop. Other modes ignore this header.
    Dim windowsUser As String: windowsUser = Trim$(Environ$("Username"))
    If Len(windowsUser) > 0 Then http.SetRequestHeader "X-User-Name", windowsUser
    Set NewHttpRequest = http
End Function

Public Function PostJson(ByVal endpoint As String, ByVal jsonBody As String) As Object
    Dim http As Object: Set http = NewHttpRequest("POST", endpoint)
    http.SetRequestHeader "Content-Type", "application/json"
    http.Send jsonBody
    If http.Status <> 200 Then RaiseHttpError "PostJson", http
    ValidateServerContract http
    Set PostJson = ParseJson(http.ResponseText)
End Function

Public Function GetJson(ByVal endpoint As String) As Object
    Dim attempt As Long, http As Object, sendError As String
    For attempt = 1 To 2
        Set http = NewHttpRequest("GET", endpoint)
        sendError = ""
        On Error Resume Next
        http.Send
        If Err.Number <> 0 Then sendError = Err.Description: Err.Clear
        On Error GoTo 0
        If Len(sendError) = 0 Then
            If http.Status < 500 Then Exit For
        End If
        DoEvents
    Next attempt
    If Len(sendError) > 0 Then Err.Raise vbObjectError + 1002, "modHttpJson.GetJson", sendError
    If http.Status <> 200 Then RaiseHttpError "GetJson", http
    ValidateServerContract http
    Set GetJson = ParseJson(http.ResponseText)
End Function

Private Sub RaiseHttpError(ByVal sourceName As String, ByVal http As Object)
    Err.Raise vbObjectError + 1000, "modHttpJson." & sourceName, _
        "API call failed (" & http.Status & "): " & http.ResponseText
End Sub

Private Sub ValidateServerContract(ByVal http As Object)
    Dim actual As String
    On Error Resume Next: actual = http.GetResponseHeader("X-Bridge-Contract"): On Error GoTo 0
    If actual <> REQUIRED_CONTRACT_VERSION Then Err.Raise vbObjectError + 1003, "modHttpJson", _
        "Excel/API version mismatch. Install the current workbook and restart the current API."
End Sub

Private Function NewRequestID() As String
    Randomize
    NewRequestID = Format$(Now, "yyyymmddhhnnss") & "-" & Hex$(CLng(Timer * 1000)) & "-" & Hex$(CLng(Rnd() * 2147483647#))
End Function

Public Function UrlEncode(ByVal value As String) As String
    Dim result As String, i As Long, character As String
    For i = 1 To Len(value)
        character = Mid$(value, i, 1)
        Select Case character
            Case "A" To "Z", "a" To "z", "0" To "9", "-", "_", "."
                result = result & character
            Case " ": result = result & "%20"
            Case Else: result = result & "%" & Right$("0" & Hex$(AscW(character) And &HFF), 2)
        End Select
    Next i
    UrlEncode = result
End Function

Public Function DateToIsoString(ByVal value As Variant) As Variant
    Dim serial As Double
    If IsNull(value) Or IsEmpty(value) Or Len(Trim$(CStr(value & ""))) = 0 Then
        DateToIsoString = Null
    ElseIf IsDate(value) Then
        DateToIsoString = Format$(CDate(value), "yyyy-mm-dd")
    ElseIf IsNumeric(value) Then
        ' Range.Value2 returns an Excel date as a Double. VBA IsDate may reject
        ' that numeric subtype, so convert valid 1900-date-system serials explicitly.
        serial = CDbl(value)
        If serial >= 1 And serial < 2958466# Then
            DateToIsoString = Format$(DateSerial(1899, 12, 30) + serial, "yyyy-mm-dd")
        Else
            DateToIsoString = CStr(value)
        End If
    Else
        DateToIsoString = CStr(value)
    End If
End Function

Public Function BytesToBase64(ByRef bytes() As Byte) As String
    Dim node As Object: Set node = CreateObject("MSXML2.DOMDocument").createElement("b64")
    node.DataType = "bin.base64": node.nodeTypedValue = bytes
    BytesToBase64 = Replace(node.Text, vbLf, "")
End Function

Public Function Base64ToBytes(ByVal value As String) As Byte()
    Dim node As Object: Set node = CreateObject("MSXML2.DOMDocument").createElement("b64")
    node.DataType = "bin.base64": node.Text = value
    Base64ToBytes = node.nodeTypedValue
End Function

Public Function ShouldSkipRow(ByVal commandValue As Variant) As Boolean
    Dim commandText As String: commandText = UCase$(Trim$(CStr(commandValue & "")))
    ShouldSkipRow = (commandText = "" Or commandText = "N")
End Function
