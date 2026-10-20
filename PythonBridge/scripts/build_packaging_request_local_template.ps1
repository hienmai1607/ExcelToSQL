param([string]$OutputPath=(Join-Path (Split-Path $PSScriptRoot -Parent) 'templates\Packaging_Request_Local_Update.xlsm'))
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$target=[IO.Path]::GetFullPath($OutputPath)
if(Test-Path -LiteralPath $target){
 . (Join-Path $PSScriptRoot 'workbook_backup.ps1')
 [void](New-WorkbookBackup -WorkbookPath $target)
}
[void][IO.Directory]::CreateDirectory((Split-Path $target -Parent))
$excel=$null;$book=$null
try {
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false
 $book=$excel.Workbooks.Add(-4167)
 while($book.Worksheets.Count -lt 3){[void]$book.Worksheets.Add([Type]::Missing,$book.Worksheets.Item($book.Worksheets.Count))}
 $data=$book.Worksheets.Item(1);$data.Name='Packaging Request'
 $controls=$book.Worksheets.Item(2);$controls.Name='Controls'
 $config=$book.Worksheets.Item(3);$config.Name='_Config'
 $data.Cells.Item(1,1)='Packaging Request';$data.Cells.Item(2,1)='Command'
 $controls.Cells.Item(1,1)='Packaging Request Excel Local Update'
 $labels=@('Request / Opportunity / Customer prefix','Status (Open / Completed / Canceled)','Mode','Page','Requests per page (1-500)','Total requests')
 for($i=0;$i -lt $labels.Count;$i++){$controls.Cells.Item($i+3,1)=$labels[$i];$controls.Cells.Item($i+3,2)='0'}
 $controls.Columns.Item(1).ColumnWidth=38;$controls.Columns.Item(2).ColumnWidth=32
 $controls.Range('A10').Value2='Save uses your Windows identity. Development header mode is testing only.'
 $controls.Range('A11').Value2='Responses only: Item Action U; blank unchanged. Creation, PIC and workflow actions remain in the app.'
 $controls.Range('A12').Value2='Pages keep whole requests together. Packaging PIC / Admin can edit unlocked responses.'
 $buttons=@(@('Save','PackagingRequestSave'),@('Refresh','PackagingRequestRefresh'),@('Filter','PackagingRequestFilter'),@('Previous','PackagingRequestPrevious'),@('Next','PackagingRequestNext'))
 for($i=0;$i -lt $buttons.Count;$i++){
  $button=$controls.Buttons().Add(10+($i%3)*125,220+[Math]::Floor($i/3)*35,115,28)
  $button.Caption=$buttons[$i][0];$button.OnAction=$buttons[$i][1]
 }
 $legend=@(
  @('Required for review *','Orange: required before Submit in the app, not required for draft Save.',0x83B1F4),
  @('Editable response','Light orange: response inputs; role, PIC and stage rules still apply.',0xD6E4FC),
  @('Display only','Blue: header. Gray: source snapshots, PIC, stages and metadata.',0xE6E6E7)
 )
 for($i=0;$i -lt $legend.Count;$i++){
  $cell=$controls.Cells.Item(22+$i,1)
  $cell.Value2=$legend[$i][0];$cell.Interior.Color=$legend[$i][2];$cell.Font.Bold=$true
  $controls.Cells.Item(22+$i,2).Value2=$legend[$i][1]
 }
 $config.Visible=2
 foreach($name in @('JsonConverter.bas','modSaveConfirmation.bas','modLocalDropdowns.bas','modPackagingRequestLocal.bas')){
  [void]$book.VBProject.VBComponents.Import((Join-Path $root $name))
 }
 [void]$book.VBProject.References.AddFromGuid('{420B2830-E718-11CF-893D-00A0C9054228}',1,0)
 $data.Activate()
 $book.SaveAs($target,52)
 $book.Close($false);$book=$null
 "Built $target"
} finally {
 if($null -ne $book){$book.Close($false)}
 if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}
