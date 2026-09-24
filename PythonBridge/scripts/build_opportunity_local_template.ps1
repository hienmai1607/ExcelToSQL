param([string]$OutputPath=(Join-Path (Split-Path $PSScriptRoot -Parent) 'templates\Opportunity_Local_Update.xlsm'))
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
 $data=$book.Worksheets.Item(1);$data.Name='Opportunity'
 $controls=$book.Worksheets.Item(2);$controls.Name='Controls'
 $config=$book.Worksheets.Item(3);$config.Name='_Config'
 $data.Cells.Item(1,1)='Opportunity';$data.Cells.Item(2,1)='Command'
 $controls.Cells.Item(1,1)='Opportunity Excel Local Update'
 $labels=@('Opportunity number prefix','Customer name prefix','Header stage (blank = all)','Page','Opportunities per page (1-500)','Total Opportunities','Bid open from (YYYY-MM-DD)','Bid open to (YYYY-MM-DD)')
 for($i=0;$i -lt $labels.Count;$i++){$controls.Cells.Item($i+3,1)=$labels[$i];$controls.Cells.Item($i+3,2)='0'}
 $controls.Columns.Item(1).ColumnWidth=38;$controls.Columns.Item(2).ColumnWidth=32
 $controls.Range('A12').Value2='Save uses your Windows identity. Development header mode is testing only.'
 $controls.Range('A13').Value2='Header / Item Command: C create, U update, D delete, N unchanged. Draft only.'
 $controls.Range('A14').Value2='Page size counts headers; all their items stay together. Required columns remain visible.'
 $buttons=@(@('Save','OpportunitySave'),@('Refresh','OpportunityRefresh'),@('Filter','OpportunityFilter'),@('Previous','OpportunityPrevious'),@('Next','OpportunityNext'),@('New Opportunity','OpportunityNew'))
 for($i=0;$i -lt $buttons.Count;$i++){
  $button=$controls.Buttons().Add(10+($i%3)*125,250+[Math]::Floor($i/3)*35,115,28)
  $button.Caption=$buttons[$i][0];$button.OnAction=$buttons[$i][1]
 }
 $legend=@(
  @('Header required *','Blue: required Header fields. Optional editable Header fields use light blue.',0xEED7BD),
  @('Item required *','Orange: required Item fields. Optional editable Item fields use light orange.',0x83B1F4),
  @('Display only','Gray: stages, Product info, responses and metadata. Do not edit.',0xE6E6E7)
 )
 for($i=0;$i -lt $legend.Count;$i++){
  $cell=$controls.Cells.Item(22+$i,1)
  $cell.Value2=$legend[$i][0];$cell.Interior.Color=$legend[$i][2];$cell.Font.Bold=$true
  $controls.Cells.Item(22+$i,2).Value2=$legend[$i][1]
 }
 $controls.Range('A26').Value2='Add item: select an Opportunity data row and press Ctrl+Shift+I (or run OpportunityAddItem).'
 $book.VBProject.VBComponents.Item('ThisWorkbook').CodeModule.AddFromString(@'
Private Sub Workbook_Activate()
 Application.OnKey "^+i", "'" & ThisWorkbook.Name & "'!OpportunityAddItem"
End Sub
Private Sub Workbook_Deactivate()
 Application.OnKey "^+i"
End Sub
'@)
 $config.Visible=2
 foreach($name in @('JsonConverter.bas','modSaveConfirmation.bas','modOpportunityLocal.bas')){
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
