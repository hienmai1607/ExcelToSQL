param([Parameter(Mandatory=$true)][string]$WorkbookPath,[switch]$Refresh)
$ErrorActionPreference='Stop'
$excel=$null;$book=$null
try{
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false
 $book=$excel.Workbooks.Open((Resolve-Path -LiteralPath $WorkbookPath).Path,0,$false)
 $ws=$book.Worksheets.Item('Product')
 if($ws.Cells.Item(2,2).Value2 -ne 'Grade'){throw 'Selected column order not preserved'}
 if($ws.Rows.Item(2).Hidden -ne $true){throw 'Field keys should be hidden'}
 if($Refresh){
  $excel.Run("'$($book.Name)'!ProductRefresh")
  if([int]$book.Worksheets.Item('Controls').Range('B8').Value2 -lt 1){throw 'Live refresh returned no products'}
  'PASS: live Refresh loaded products through the API.'
 }
 $last=$ws.Cells.Find('*',[Type]::Missing,[Type]::Missing,[Type]::Missing,1,2).Row
 $excel.Run("'$($book.Name)'!ProductNew")
 if($ws.Cells.Item($last+1,1).Value2 -ne 'C'){throw 'New Product did not add a C row'}
 $found=$ws.Rows.Item(2).Find('Category')
 if($ws.Columns.Item($found.Column).Hidden){throw 'Required Category column not revealed'}
 'PASS: downloaded XLSM opens, VBA compiles, New Product reveals required fields.'
 $book.Close($false);$book=$null
}finally{
 if($null -ne $book){$book.Close($false)}
 if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}
