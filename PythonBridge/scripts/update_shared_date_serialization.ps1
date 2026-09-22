param([string]$Root=(Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'workbook_backup.ps1')
$workbooks=@('Admin_Master.xlsm','Product_Template.xlsm','Sales_Template.xlsm','Packaging_Template.xlsm')
$modulePath=(Resolve-Path -LiteralPath (Join-Path $Root 'modHttpJson.bas')).Path
foreach($name in $workbooks) {
    if(Test-Path -LiteralPath (Join-Path $Root ('~$'+$name))) { throw ('Close '+$name+' before updating.') }
}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$excel=$null
$book=$null
try {
    $excel=New-Object -ComObject Excel.Application
    $excel.Visible=$false
    $excel.DisplayAlerts=$false
    $excel.EnableEvents=$false
    foreach($name in $workbooks) {
        $path=(Resolve-Path -LiteralPath (Join-Path $Root $name)).Path
        $backup=New-WorkbookBackup -WorkbookPath $path
        $book=$excel.Workbooks.Open($path,0,$false)
        if($book.ReadOnly){throw ($name+' opened read-only.')}
        $old=$null
        try{$old=$book.VBProject.VBComponents.Item('modHttpJson')}catch{}
        if($null -ne $old){$book.VBProject.VBComponents.Remove($old)}
        [void]$book.VBProject.VBComponents.Import($modulePath)
        $actual=$excel.Run("'$($book.Name)'!DateToIsoString",46284)
        if([string]$actual -ne '2026-09-19'){throw ($name+': date conversion compile check failed: '+$actual)}
        $book.Save()
        $book.Close($false)
        $book=$null
        Write-Output ('UPDATED '+$name+'; backup: '+$backup)
    }
}
finally {
    if($null -ne $book){$book.Close($false)}
    if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}
