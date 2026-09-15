param([string]$SalesWorkbookPath)

$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $SalesWorkbookPath).Path
$tempPath=Join-Path ([IO.Path]::GetTempPath()) ("OpportunityRefreshContract_{0}.xlsm" -f [guid]::NewGuid().ToString('N'))
Copy-Item -LiteralPath $source -Destination $tempPath
$excel=$null
$workbook=$null

try {
    $excel=New-Object -ComObject Excel.Application
    $excel.Visible=$false
    $excel.DisplayAlerts=$false
    $workbook=$excel.Workbooks.Open($tempPath,0,$false)
    $module=$workbook.VBProject.VBComponents.Item('modUnifiedOpportunityBridge').CodeModule

    # Keep the public Refresh interface, but make its error handler observable
    # instead of displaying a modal MsgBox that would block unattended tests.
    for($line=1;$line -le $module.CountOfLines;$line++) {
        if($module.Lines($line,1) -like 'Failed: MsgBox "Refresh failed:*') {
            $module.ReplaceLine($line,'Failed: ws.Range("AB2").Value = Err.Number & "|" & Err.Description: Exit Sub')
            break
        }
    }

    $sheet=$workbook.Worksheets.Item('Opportunity')
    $sheet.Unprotect()
    [void]$sheet.Range('AB2').ClearContents()
    $excel.Run("'$($workbook.Name)'!RefreshUnifiedOpportunity")
    $errorText=[string]$sheet.Range('AB2').Value2
    if($errorText) {throw "Opportunity Refresh failed: $errorText"}
    if($sheet.ProtectContents) {throw 'Opportunity Refresh protected the interactive sheet.'}
    if($sheet.Range('C2').Validation.Formula1 -ne '=OpportunityCustomerNames') {throw 'Customer validation was not restored.'}
    if($sheet.Range('I2').Validation.Formula1 -ne '=OpportunityProductCodes') {throw 'Product validation was not restored.'}
    'PASS: Opportunity Refresh workbook contract'
}
finally {
    if($null -ne $workbook) {$workbook.Close($false)}
    if($null -ne $excel) {$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
    if(Test-Path -LiteralPath $tempPath) {Remove-Item -LiteralPath $tempPath -Force}
}
