$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'workbook_backup.ps1')
$root=Split-Path $PSScriptRoot -Parent
$updates=@(
    @{File='Admin_Master.xlsm';Modules=@{modAdminMasterBridge=@('AdminConfirmationMessage','ConfirmAdminMasterSaveAligned','CanReplaceAdminRows')}},
    @{File='Product_Template.xlsm';Modules=@{modUserMasterBridge=@('UserMasterConfirmationMessage','ConfirmUserMasterSave','CanReplaceUserMasterRows')}},
    @{File='Sales_Template.xlsm';Modules=@{modUserMasterBridge=@('UserMasterConfirmationMessage','ConfirmUserMasterSave','CanReplaceUserMasterRows');modUnifiedOpportunityBridge=@('SaveUnifiedOpportunity','OpportunityConfirmationMessage','CanDiscardUnified')}},
    @{File='Packaging_Template.xlsm';Modules=@{modPackagingBridge=@('PackagingConfirmationMessage','PackagingSave','RefreshPage')}}
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
        Install-SharedPagination $book
        $old=$null
        try{$old=$book.VBProject.VBComponents.Item('modSaveConfirmation')}catch{}
        if($null -ne $old){$book.VBProject.VBComponents.Remove($old)}
        [void]$book.VBProject.VBComponents.Import((Join-Path $root 'modSaveConfirmation.bas'))
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
        $message=$excel.Run("'$($book.Name)'!BuildSaveConfirmation",'Test',1,2,3,'Block','')
        if($message -notlike '*Create: 1*' -or $message -notlike '*Block: 3*'){throw 'Shared confirmation compile check failed.'}
        if($update.File -eq 'Packaging_Template.xlsm') {
            $guide=$book.Worksheets.Item('Read Me')
            foreach($cell in $guide.UsedRange.Cells) {
                if($cell.Value2 -is [string]) {
                    $text=$cell.Value2.Replace('Packaging scope required.','Packaging or Admin scope required.')
                    $text=$text.Replace('Packaging Request: U saves assigned PIC responses. Packaging scope and editable item stage required.','Packaging Request: U saves assigned PIC responses, or any eligible response for Admin. Editable stage required.')
                    if($text -ne $cell.Value2){$cell.Value2=$text}
                }
            }
            $guide.Cells.Item(20,1).Value2='Admin can perform all Packaging actions; stage locks, required fields and RowVersion checks still apply.'
            $guide.Cells.Item(21,1).Value2='Shared Save confirmation includes filtered-out rows and defaults to No.'
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
