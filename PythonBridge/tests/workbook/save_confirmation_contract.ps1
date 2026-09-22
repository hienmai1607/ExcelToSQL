$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$excel=$null
$book=$null
try {
    $excel=New-Object -ComObject Excel.Application
    $excel.Visible=$false
    $excel.DisplayAlerts=$false
    $excel.EnableEvents=$false
    foreach($file in @('Admin_Master.xlsm','Product_Template.xlsm','Sales_Template.xlsm','Packaging_Template.xlsm')) {
        $book=$excel.Workbooks.Open((Join-Path $root $file),0,$true)
        $shared=$book.VBProject.VBComponents.Item('modSaveConfirmation').CodeModule
        $source=$shared.Lines(1,$shared.CountOfLines)
        if($source -notmatch 'vbDefaultButton2'){throw 'Confirmation must default to No.'}
        $sheet=$book.Worksheets.Add()
        $sheet.Name='ConfirmContract'
        $sheet.Range('A2').Value2='C'
        $sheet.Range('A3').Value2='u'
        $sheet.Range('A4').Value2='D'
        $sheet.Rows.Item(4).Hidden=$true
        foreach($label in @('Delete','Block','Deactivate')) {
            $message=[string]$excel.Run("'$($book.Name)'!CommandConfirmationMessage",$sheet,'Test',1,2,4,$label,'CUD','')
            if($message -notlike '*Create: 1*' -or $message -notlike '*Update: 1*' -or $message -notlike ('*'+$label+': 1*') -or $message -notlike '*hidden by filters*'){
                throw ('Wrong confirmation: '+$message)
            }
            if(($label -eq 'Delete') -ne ($message -like '*Delete is permanent.*')){throw 'Wrong permanent-delete warning.'}
        }
        $sheet.Range('A2:A4').ClearContents()
        $message=[string]$excel.Run("'$($book.Name)'!CommandConfirmationMessage",$sheet,'Test',1,2,4,'Delete','CUD','')
        if($message){throw 'Empty command range should not prompt.'}
        $module=$book.VBProject.VBComponents.Add(1)
        $module.Name='ConfirmAssertions'
        $module.CodeModule.AddFromString(@'
Option Explicit
Public Function VerifySpecificConfirmations() As String
    On Error GoTo Failed
    Dim ws As Worksheet, result As String
    Select Case ThisWorkbook.Name
    Case "Admin_Master.xlsm"
        Set ws = ThisWorkbook.Worksheets("Users")
        ws.Columns("A").ClearContents: ws.Range("A2").Value = "D"
        result = AdminConfirmationMessage(ws, "Users")
        If InStr(result, "Deactivate: 1") = 0 Then Err.Raise 5, , "Users deactivation missing"
    Case "Product_Template.xlsm"
        Set ws = ThisWorkbook.Worksheets("Product")
        ws.Columns("A").ClearContents: ws.Range("A2").Value = "D"
        result = UserMasterConfirmationMessage(ws, "Product")
        If InStr(result, "Block: 1") = 0 Then Err.Raise 5, , "Product block missing"
    Case "Sales_Template.xlsm"
        Dim headers As New Collection, items As New Collection, row As Object
        Set row = CreateObject("Scripting.Dictionary"): row.Add "Command", "U": headers.Add row
        Set row = CreateObject("Scripting.Dictionary"): row.Add "Command", "C": items.Add row
        Set row = CreateObject("Scripting.Dictionary"): row.Add "Command", "D": items.Add row
        result = OpportunityConfirmationMessage(headers, items)
        If InStr(result, "Headers - Create: 0, Update: 1, Delete: 0") = 0 Then Err.Raise 5, , "Header count wrong"
        If InStr(result, "Items - Create: 1, Update: 0, Delete: 1") = 0 Then Err.Raise 5, , "Item count wrong"
    Case "Packaging_Template.xlsm"
        Set ws = ThisWorkbook.Worksheets("Manual Request")
        ws.ListObjects(1).DataBodyRange.ClearContents
        ws.Range("A2:A3").Value = "C": ws.Range("Q2:Q3").Value = 101
        result = PackagingConfirmationMessage(ws)
        If InStr(result, "Requests: 1") = 0 Or InStr(result, "Create: 2") = 0 Then Err.Raise 5, , "Manual request grouping wrong"
        Set ws = ThisWorkbook.Worksheets("Packaging Request")
        ws.ListObjects(1).DataBodyRange.ClearContents
        ws.Range("A2").Value = "U"
        result = PackagingConfirmationMessage(ws)
        If InStr(result, "Update: 1") = 0 Then Err.Raise 5, , "Response count wrong"
    End Select
    VerifySpecificConfirmations = "PASS: entity-specific counts and action labels."
    Exit Function
Failed:
    VerifySpecificConfirmations = "FAIL: " & Err.Description
End Function
'@)
        # Avoid references to modules not present in each workbook by stripping
        # unrelated Case blocks before the VBA compiler resolves procedure names.
        $code=$module.CodeModule.Lines(1,$module.CodeModule.CountOfLines)
        $pattern='(?ms)^    Case "([^"]+)"\r?\n(.*?)(?=^    Case |^    End Select)'
        $fileForFilter=$file
        $code=[regex]::Replace($code,$pattern,[System.Text.RegularExpressions.MatchEvaluator]{
            param($match)
            if($match.Groups[1].Value -eq $fileForFilter){return $match.Value}
            return ''
        })
        $module.CodeModule.DeleteLines(1,$module.CodeModule.CountOfLines)
        $module.CodeModule.AddFromString($code)
        $result=[string]$excel.Run("'$($book.Name)'!VerifySpecificConfirmations")
        if($result -notlike 'PASS:*'){throw $result}
        Write-Output ('PASS: '+$file+' - shared format, hidden rows, action semantics, default No; '+$result)
        $book.Close($false);$book=$null
    }
}
finally {
    if($null -ne $book){$book.Close($false)}
    if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}

