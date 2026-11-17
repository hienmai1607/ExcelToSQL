# Verifies that every Local Update template disables Excel AutoComplete only while it is active
# (hidden field keys such as "Command" must not be suggested) and restores the user's setting.
param([string[]]$Templates=@('Packaging_Master_Local_Update.xlsm','Packaging_Request_Local_Update.xlsm','Product_Local_Update.xlsm','Opportunity_Local_Update.xlsm'))
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$directory=Join-Path ([IO.Path]::GetTempPath()) ('bridge-autocomplete-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($directory)
$excel=$null;$original=$null
function Expect($actual,$expected,$step){if($actual -ne $expected){throw "FAIL ${step}: AutoComplete=$actual, expected $expected"}}
try{
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false
 $original=$excel.EnableAutoComplete
 foreach($name in $Templates){
  foreach($preference in $true,$false){
   $copy=Join-Path $directory ([guid]::NewGuid().ToString('N')+'.xlsm')
   Copy-Item -LiteralPath (Join-Path $root "templates\$name") -Destination $copy
   $excel.EnableAutoComplete=$preference
   $book=$excel.Workbooks.Open($copy)
   $book.Activate();Expect $excel.EnableAutoComplete $false "$name open"
   $other=$excel.Workbooks.Add();$other.Activate();Expect $excel.EnableAutoComplete $preference "$name deactivate"
   $book.Activate();Expect $excel.EnableAutoComplete $false "$name reactivate"
   $book.Close($false);Expect $excel.EnableAutoComplete $preference "$name close"
   $other.Close($false)
  }
  "PASS: $name"
 }
}finally{
 if($null -ne $excel){
  if($null -ne $original){$excel.EnableAutoComplete=$original}
  $excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
 }
 Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue
}
