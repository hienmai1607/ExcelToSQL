# Tests the actual generated event bodies with an OnKey implementation that raises Excel error 1004.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$source=Get-Content -LiteralPath (Join-Path $root 'scripts\build_opportunity_local_template.ps1') -Raw
$match=[regex]::Match($source,"(?s)Private Sub Workbook_Activate\(\).*?End Sub\s*Private Sub Workbook_Deactivate\(\).*?End Sub")
if(-not $match.Success){throw 'Workbook shortcut event code not found'}
$events=$match.Value.Replace('Private Sub Workbook_Activate','Public Sub ProbeActivate').Replace('Private Sub Workbook_Deactivate','Public Sub ProbeDeactivate').Replace('Application.OnKey','ProbeApplication.OnKey')
$excel=$null;$book=$null;$testPath=$null;$testDirectory=$null
try {
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false
 $book=$excel.Workbooks.Add(-4167)
 $fake=$book.VBProject.VBComponents.Add(2);$fake.Name='KeyboardProbe'
 $fake.CodeModule.AddFromString(@'
Public Fail As Boolean
Public Calls As Long
Public Sub OnKey(ByVal Key As String, Optional ByVal Procedure As Variant)
 Calls = Calls + 1
 If Fail Then Err.Raise 1004, , "Method OnKey of object Application failed"
End Sub
'@)
 $module=$book.VBProject.VBComponents.Add(1);$module.Name='ShortcutRegression'
 $module.CodeModule.AddFromString("Option Explicit"+[Environment]::NewLine+"Private ProbeApplication As KeyboardProbe"+[Environment]::NewLine+$events+[Environment]::NewLine+@'
Public Function CheckShortcuts() As String
 On Error GoTo Failed
 Set ProbeApplication = New KeyboardProbe
 ProbeApplication.Fail = True
 ProbeActivate
 ProbeDeactivate
 ProbeApplication.Fail = False
 ProbeActivate
 ProbeDeactivate
 If ProbeApplication.Calls <> 4 Then Err.Raise 5, , "Shortcut handlers did not execute"
 CheckShortcuts = "OK"
 Exit Function
Failed:
 CheckShortcuts = CStr(Err.Number) & ": " & Err.Description
End Function
'@)
 $testDirectory=Join-Path ([IO.Path]::GetTempPath()) ('bridge-shortcut-test-'+[guid]::NewGuid().ToString('N'))
 [void](New-Item -ItemType Directory -Path $testDirectory)
 $testPath=Join-Path $testDirectory 'ShortcutRegression.xlsm'
 $book.SaveAs($testPath,52)
 $result=$excel.Run("'"+$book.Name+"'!CheckShortcuts")
 if($result -ne 'OK'){throw "FAIL: $result"}
 'PASS: generated Activate/Deactivate handlers tolerate OnKey error 1004 and still run normally.'
} finally {
 if($null -ne $book){$book.Close($false)}
 if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
 if($testPath -and (Test-Path -LiteralPath $testPath)){Remove-Item -LiteralPath $testPath -Force}
 if($testDirectory -and (Test-Path -LiteralPath $testDirectory)){Remove-Item -LiteralPath $testDirectory}
}
