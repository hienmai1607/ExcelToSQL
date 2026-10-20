param()
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$folder=Join-Path ([IO.Path]::GetTempPath()) ('PythonBridge-dropdown-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $folder)
$path=Join-Path $folder 'Packaging_Flags_Smoke.xlsm'
Push-Location $root
try {
 $encoded=python -c "import sys,base64;sys.path.insert(0,'tests/python');from packaging_flags_excel_contract import WorkbookFlags;print(base64.b64encode(WorkbookFlags().workbook()).decode())"
 if($LASTEXITCODE -ne 0){throw 'Fixture generation failed.'}
 [IO.File]::WriteAllBytes($path,[Convert]::FromBase64String($encoded))
} finally {Pop-Location}
$excel=$null;$book=$null
try {
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false;$excel.EnableEvents=$false
 # Only this isolated, generated fixture is opened. No registry or user security setting is changed.
 $excel.AutomationSecurity=1
 $book=$excel.Workbooks.Open($path,0,$false)
 $data=$book.Worksheets.Item('Master')
 if($data.Cells.Item(1,1).Value2 -ne 'Action (C/U)'){throw 'Wrong Command caption.'}
 if($data.Cells.Item(3,1).Validation.Type -ne 3){throw 'Missing Command dropdown.'}
 if($data.Cells.Item(3,1).Validation.Formula1 -ne '=PB_DD_Command'){throw 'Wrong Command validation.'}
 [void]$excel.Run("'"+$book.Name+"'!InitializeLocalRow",$data,4)
 $flag=$data.Rows.Item(2).Find('Primary',[Type]::Missing,[Type]::Missing,1)
 if([string]$data.Cells.Item(4,$flag.Column).Value2 -cne 'False'){throw 'Flag defaults failed.'}
 $response=$excel.Run("'"+$book.Name+"'!JsonConverter.ParseJson",'{"dropdowns":{"Command":["C","U"],"Primary":["True","False"],"ParentType":["Secondary / Refreshed root"]}}')
 [void]$excel.Run("'"+$book.Name+"'!RefreshLocalDropdowns",$data,$response)
 if($book.Worksheets.Item('_Lists').Visible -ne 2){throw 'Lookup sheet must remain very hidden.'}
 $names=$book.Names.Item('PB_DD_ParentType')
 if($names.RefersToRange.Cells.Item(1,1).Value2 -ne 'Secondary / Refreshed root'){throw 'Realtime lookup refresh failed.'}
 $book.Save()
 $book.Close($false);$book=$null
 Push-Location $root
 try {
  $fixtures=python -c "import sys,base64,json;sys.path.insert(0,'tests/python');from packaging_flags_excel_contract import transaction_workbooks;print(json.dumps([dict(name=n,blob=base64.b64encode(b).decode(),first=f,key=k) for n,b,f,k in transaction_workbooks()]))" | ConvertFrom-Json
  if($LASTEXITCODE -ne 0){throw 'Transaction fixture generation failed.'}
 } finally {Pop-Location}
 foreach($fixture in $fixtures){
  $fixturePath=Join-Path $folder ($fixture.name+'.xlsm')
  [IO.File]::WriteAllBytes($fixturePath,[Convert]::FromBase64String($fixture.blob))
  $book=$excel.Workbooks.Open($fixturePath,0,$false)
  $data=$book.Worksheets.Item(1)
  $command=$book.Names.Item('PB_DD_'+$fixture.key)
  if($command.RefersToRange.Cells.Item(1,1).Value2 -notin @('C','U')){throw 'Wrong transaction command choices.'}
  $response=$excel.Run("'"+$book.Name+"'!JsonConverter.ParseJson",('{"dropdowns":{"'+$fixture.key+'":["U"]}}'))
  [void]$excel.Run("'"+$book.Name+"'!RefreshLocalDropdowns",$data,$response)
  if($book.Names.Item('PB_DD_'+$fixture.key).RefersToRange.Cells.Item(1,1).Value2 -ne 'U'){throw 'Transaction dropdown refresh failed.'}
  $book.Close($false);$book=$null
  Write-Output ('PASS: '+$fixture.name+' opened and refreshed in real Excel.')
 }
 Write-Output 'PASS: all four workbook types opened without repair; C/U dropdown, boolean defaults and realtime lookup refresh verified.'
 Write-Output ('Fixture: '+$path)
} finally {
 if($null -ne $book){$book.Close($false)}
 if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)}
 [GC]::Collect();[GC]::WaitForPendingFinalizers()
}
