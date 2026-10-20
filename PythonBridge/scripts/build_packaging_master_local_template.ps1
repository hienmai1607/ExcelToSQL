param([string]$OutputPath=(Join-Path (Split-Path $PSScriptRoot -Parent) 'templates\Packaging_Master_Local_Update.xlsm'))
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
 $data=$book.Worksheets.Item(1);$data.Name='Master'
 $controls=$book.Worksheets.Item(2);$controls.Name='Controls'
 $config=$book.Worksheets.Item(3);$config.Name='_Config'
 $data.Cells.Item(1,1)='Master';$data.Cells.Item(2,1)='Command'
 $controls.Cells.Item(1,1)='Packaging Master Excel Local Update'
 $labels=@('Search (code/name prefix)','Status (Active / Block / blank)','Created by (username / blank)','Page','Rows per page','Total rows','Material code (Pricing only)','Currency code (Pricing only)','Effective on (Pricing only)')
 for($i=0;$i -lt $labels.Count;$i++){$controls.Cells.Item($i+3,1)=$labels[$i];$controls.Cells.Item($i+3,2)='0'}
 $controls.Columns.Item(1).ColumnWidth=38;$controls.Columns.Item(2).ColumnWidth=32
 $controls.Range('A13').Value2='Save uses your Windows identity. Development header mode is testing only.'
 $controls.Range('A14').Value2='Action: C create, U update; blank unchanged. Use the separate Status column to block records. Audit fields and Pricing material name are display only.'
 $controls.Range('A15').Value2='Required columns remain visible. Dates use YYYY-MM-DD. Refresh confirms before discarding edits.'
 $buttons=@(@('Save','PackagingMasterSave'),@('Refresh','PackagingMasterRefresh'),@('Filter','PackagingMasterFilter'),@('Previous','PackagingMasterPrevious'),@('Next','PackagingMasterNext'),@('New record','PackagingMasterNew'))
 for($i=0;$i -lt $buttons.Count;$i++){
  $button=$controls.Buttons().Add(10+($i%3)*125,270+[Math]::Floor($i/3)*35,115,28)
  $button.Caption=$buttons[$i][0];$button.OnAction=$buttons[$i][1]
 }
 $legend=@(
  @('Required *','Yellow: required inputs; these columns remain visible.',0xCCF2FF),
  @('Editable','Optional input columns and Action.',0xF7EBDD),
  @('Display only','Gray: material name in Pricing, audit fields, results and metadata.',0xE6E6E7)
 )
 for($i=0;$i -lt $legend.Count;$i++){
  $cell=$controls.Cells.Item(25+$i,1)
  $cell.Value2=$legend[$i][0];$cell.Interior.Color=$legend[$i][2];$cell.Font.Bold=$true
  $controls.Cells.Item(22+$i,2).Value2=$legend[$i][1]
 }
 $config.Visible=2
 foreach($name in @('JsonConverter.bas','modSaveConfirmation.bas','modLocalDropdowns.bas','modPackagingMasterLocal.bas')){
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
