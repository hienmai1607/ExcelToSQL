$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'workbook_backup.ps1')
$root=Split-Path $PSScriptRoot -Parent
$updates=@(
 @{File='Admin_Master.xlsm';Modules=@{modAdminMasterBridge=@('ConfigureAdminSheet','RefreshAdminSheet','PreviousAdminPage','NextAdminPage')}},
 @{File='Product_Template.xlsm';Modules=@{modUserMasterBridge=@('ConfigureUserMasterSheet','RefreshUserMasterSheet','UserMasterReadUrl','ChangeUserMasterPage')}},
 @{File='Sales_Template.xlsm';Modules=@{modUserMasterBridge=@('ConfigureUserMasterSheet','RefreshUserMasterSheet','UserMasterReadUrl','ChangeUserMasterPage');modUnifiedOpportunityBridge=@('ConfigureUnifiedOpportunity','RefreshUnifiedOpportunity','PreviousOpportunityPage','NextOpportunityPage')}},
 @{File='Packaging_Template.xlsm';Modules=@{modPackagingBridge=@('PackagingPageSize','RefreshPage')}}
)
foreach($update in $updates) {
    if(Test-Path -LiteralPath (Join-Path $root ('~$'+$update.File))) {throw ('Close '+$update.File+' before updating.')}
}
$excel=$null
$book=$null
try {
    $excel=New-Object -ComObject Excel.Application
    $excel.Visible=$false
    $excel.DisplayAlerts=$false
    $excel.EnableEvents=$false
    foreach($update in $updates) {
        $path=Join-Path $root $update.File
        $backup=New-WorkbookBackup -WorkbookPath $path
        $book=$excel.Workbooks.Open($path,0,$false)
        if($book.ReadOnly){throw ($update.File+' opened read-only.')}
        $old=$null
        try{$old=$book.VBProject.VBComponents.Item('modPagination')}catch{}
        if($null -ne $old){$book.VBProject.VBComponents.Remove($old)}
        [void]$book.VBProject.VBComponents.Import((Join-Path $root 'modPagination.bas'))
        foreach($name in $update.Modules.Keys) {
            $target=$book.VBProject.VBComponents.Item($name).CodeModule
            $source=$book.VBProject.VBComponents.Import((Join-Path $root ($name+'.bas')))
            foreach($procedure in $update.Modules[$name]) {
                $start=$source.CodeModule.ProcStartLine($procedure,0)
                $length=$source.CodeModule.ProcCountLines($procedure,0)
                $code=$source.CodeModule.Lines($start,$length)
                $existingStart=0
                try{$existingStart=$target.ProcStartLine($procedure,0)}catch{}
                if($existingStart -gt 0){$target.DeleteLines($existingStart,$target.ProcCountLines($procedure,0))}
                $target.AddFromString($code)
            }
            $book.VBProject.VBComponents.Remove($source)
        }
        foreach($sheet in $book.Worksheets) {
            if($sheet.Name -notin @('Market','Currency','Users','User Access','Product','Customer','Opportunity','Packaging Material','Packaging Price','Packaging Request','Packaging History','Manual Request')){continue}
            $excel.Run("'$($book.Name)'!ConfigurePagination",$sheet)
            $size=$excel.Run("'$($book.Name)'!RowsPerPage",$sheet)
            if($size -lt 1 -or $size -gt 500){throw 'Page size verification failed.'}
            if($update.File -eq 'Admin_Master.xlsm') {
                $sheet.Range('M4').Value2='Page'
                $sheet.Range('M5').Value2='Loaded'
                $sheet.Range('M6').Value2='Total'
                if(!$sheet.Range('N4').Value2){$sheet.Range('N4').Value2=1}
                foreach($control in @(@('pagingPrevious','Previous','M2','PreviousAdminPage'),@('pagingNext','Next','N2','NextAdminPage'))) {
                    $button=$null
                    try{$button=$sheet.Shapes.Item($control[0])}catch{}
                    if($null -eq $button){$anchor=$sheet.Range($control[2]);$button=$sheet.Shapes.AddFormControl(0,$anchor.Left,$anchor.Top,65,22);$button.Name=$control[0]}
                    $button.TextFrame.Characters().Text=$control[1]
                    $button.OnAction="'$($book.Name)'!"+$control[3]
                }
            }
        }
        $book.Save()
        $book.Close($false)
        $book=$null
        Write-Output ('UPDATED '+$update.File+'; backup: '+$backup)
    }
}
finally {
    if($null -ne $book){$book.Close($false)}
    if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}
