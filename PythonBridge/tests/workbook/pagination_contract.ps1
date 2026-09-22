$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$excel=$null
$book=$null
try {
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false
 $excel.DisplayAlerts=$false
 $excel.EnableEvents=$false
 foreach($file in @('Admin_Master.xlsm','Product_Template.xlsm','Sales_Template.xlsm','Packaging_Template.xlsm')) {
  $book=$excel.Workbooks.Open((Join-Path $root $file),0,$true)
  $testModule=$book.VBProject.VBComponents.Add(1)
  $testModule.CodeModule.AddFromString(@'
Public Function RejectsInvalidPageSize(ByVal ws As Worksheet) As Boolean
    On Error GoTo Invalid
    Dim size As Long: size = RowsPerPage(ws)
    Exit Function
Invalid:
    RejectsInvalidPageSize = True
End Function
'@)
  foreach($sheet in $book.Worksheets) {
   if($sheet.Name -notin @('Market','Currency','Users','User Access','Product','Customer','Opportunity','Packaging Material','Packaging Price','Packaging Request','Packaging History','Manual Request')){continue}
   $sizeCell='BB4';$pageCell='BB5'
   switch($sheet.Name) {
    {$_ -in @('Market','Currency','Users','User Access','Product')} {$sizeCell='N8';$pageCell='N4'}
    'Customer' {$sizeCell='M9';$pageCell='M5'}
    'Opportunity' {$sizeCell='X7';$pageCell='X4'}
   }
   foreach($size in @(1,200,500)) {
    $sheet.Range($sizeCell).Value2=$size
    if($excel.Run("'$($book.Name)'!RowsPerPage",$sheet) -ne $size){throw 'Valid size rejected'}
   }
   foreach($bad in @(0,-1,501,2.5,'abc','')) {
    if($bad -is [string]){$sheet.Range($sizeCell).Value2=[string]$bad}else{$sheet.Range($sizeCell).Value2=[double]$bad}
    $rejected=$excel.Run("'$($book.Name)'!RejectsInvalidPageSize",$sheet)
    if(!$rejected){throw ('Invalid size accepted: '+$bad)}
   }
   $sheet.Range($sizeCell).Value2=2
   $excel.Run("'$($book.Name)'!CommitPage",$sheet,2,2,5,'filter')
   if($excel.Run("'$($book.Name)'!RequestedPage",$sheet,1,'filter') -ne 3){throw 'Next page incorrect'}
   if($excel.Run("'$($book.Name)'!RequestedPage",$sheet,-1,'filter') -ne 1){throw 'Previous page incorrect'}
   if($sheet.Range($pageCell).Value2 -ne 2){throw 'Requested page changed displayed state before success'}
   if($excel.Run("'$($book.Name)'!RequestedPage",$sheet,0,'filter') -ne 1){throw 'Refresh did not reset'}
   if($excel.Run("'$($book.Name)'!RequestedPage",$sheet,1,'different') -ne 1){throw 'Filter change did not reset'}
   $sheet.Range($sizeCell).Value2=3
   if($excel.Run("'$($book.Name)'!RequestedPage",$sheet,1,'filter') -ne 1){throw 'Size change did not reset'}
   $excel.Run("'$($book.Name)'!CommitPage",$sheet,2,2,5,'filter')
   if($excel.Run("'$($book.Name)'!RequestedPage",$sheet,1,'filter') -ne 2){throw 'Last page overshot'}
   Write-Output ('PASS: '+$file+'/'+$sheet.Name+' page sizes, reset, bounds and deferred state')
  }
  # Exercise real refresh/navigation procedures with deterministic in-memory API data.
  $http=$book.VBProject.VBComponents.Item('modHttpJson').CodeModule
  $start=$http.ProcStartLine('GetJson',0)
  $http.DeleteLines($start,$http.ProcCountLines('GetJson',0))
  $http.AddFromString(@'
Public Function GetJson(ByVal endpoint As String) As Object
    Dim result As Object: Set result = CreateObject("Scripting.Dictionary")
    Dim rows As New Collection, item As Object, page As Long, size As Long, i As Long, part As Variant, bits As Variant
    page = 1: size = 5
    For Each part In Split(Mid$(endpoint, InStr(endpoint, "?") + 1), "&")
        bits = Split(part, "=")
        If UBound(bits) = 1 Then
            If bits(0) = "page" Then page = CLng(bits(1))
            If bits(0) = "page_size" Then size = CLng(bits(1))
        End If
    Next part
    For i = (page - 1) * size + 1 To Application.Min(page * size, 5)
        Set item = CreateObject("Scripting.Dictionary")
        item.Add "ID", i: item.Add "MarketCode", "M" & i: item.Add "MarketName", "Market " & i
        item.Add "ProductCode", "P" & i: item.Add "ProductName", "Product " & i
        item.Add "OpportunityNumber", "OPP-" & i
        item.Add "RowVersion", "test": item.Add "Status", "Active": item.Add "WeightGrams", Null
        item.Add "MaterialCode", "PK" & i: item.Add "MaterialName", "Material " & i
        rows.Add item
    Next i
    result.Add "rows", rows: result.Add "page", page: result.Add "total", 5
    Set GetJson = result
End Function
'@)
  if($file -eq 'Admin_Master.xlsm'){$entity='Market';$sizeCell='N8';$pageCell='N4';$refresh='RefreshMarketSheet';$next='NextAdminPage'}
  elseif($file -eq 'Product_Template.xlsm'){$entity='Product';$sizeCell='N8';$pageCell='N4';$refresh='RefreshProductSheet';$next='NextProductPage'}
  elseif($file -eq 'Packaging_Template.xlsm'){$entity='Packaging Material';$sizeCell='BB4';$pageCell='BB5';$refresh='PackagingRefresh';$next='PackagingNext'}
  else{
   $entity='Opportunity';$sizeCell='X7';$pageCell='X4';$refresh='RefreshUnifiedOpportunity';$next='NextOpportunityPage'
   $code=$book.VBProject.VBComponents.Item('modUnifiedOpportunityBridge').CodeModule
   foreach($proc in @('RefreshOpportunityLookups','ConfigureOpportunityLookupValidation')) {
    $start=$code.ProcStartLine($proc,0)
    $code.DeleteLines($start,$code.ProcCountLines($proc,0))
    if($proc -eq 'ConfigureOpportunityLookupValidation'){$code.AddFromString("Private Sub ConfigureOpportunityLookupValidation(ByVal ws As Worksheet)`r`nEnd Sub")}
    else{$code.AddFromString("Private Sub RefreshOpportunityLookups()`r`nEnd Sub")}
   }
   $book.Worksheets.Item('Opportunity').Range('X8:X12').ClearContents()
   $book.Worksheets.Item('Opportunity').Range('H2:H10000').ClearContents()
  }
  if($entity) {
   $sheet=$book.Worksheets.Item($entity)
   $sheet.Activate()
   $sheet.Range('A2:A10000').ClearContents()
   $sheet.Range($sizeCell).Value2=2
   # Prevent modal error dialogs from hiding a failing refresh in this test copy.
   foreach($component in $book.VBProject.VBComponents) {
    if($component.Name -in @('modAdminMasterBridge','modUserMasterBridge','modPackagingBridge','modUnifiedOpportunityBridge')) {
     $code=$component.CodeModule
     for($line=1;$line -le $code.CountOfLines;$line++) {
      if($code.Lines($line,1) -match '^\s*MsgBox "Refresh failed:'){$code.ReplaceLine($line,'    Err.Raise vbObjectError + 2999, , Err.Description')}
      if($code.Lines($line,1) -match '^Failed: MsgBox "Refresh failed:'){$code.ReplaceLine($line,'Failed: Err.Raise vbObjectError + 2999, , Err.Description')}
     }
    }
   }
   $excel.Run("'$($book.Name)'!"+$refresh)
   if($sheet.Range('B2').Value2 -notmatch '1$' -or $sheet.Range($pageCell).Value2 -ne 1){throw 'Actual refresh wrong first page'}
   $excel.Run("'$($book.Name)'!"+$next)
   if($sheet.Range('B2').Value2 -notmatch '3$' -or $sheet.Range($pageCell).Value2 -ne 2){throw 'Actual navigation ignored chosen size'}
   $sheet.Range($sizeCell).Value2=3
   $excel.Run("'$($book.Name)'!"+$next)
   if($sheet.Range('B2').Value2 -notmatch '1$' -or $sheet.Range($pageCell).Value2 -ne 1){throw 'Actual resize failed to reset page'}
   Write-Output ('PASS: '+$entity+' actual Refresh/Next use selected size and reset on change (mock API)')
  }
  $book.Close($false);$book=$null
 }
} finally {
 if($null -ne $book){$book.Close($false)}
 if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}
