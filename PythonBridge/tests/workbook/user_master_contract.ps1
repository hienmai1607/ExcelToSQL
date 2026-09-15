param(
    [string]$ProductWorkbookPath,
    [string]$SalesWorkbookPath
)

$ErrorActionPreference='Stop'
$productPath=(Resolve-Path -LiteralPath $ProductWorkbookPath).Path
$salesPath=(Resolve-Path -LiteralPath $SalesWorkbookPath).Path
$excel=$null
$workbook=$null

function Assert-Headers($Sheet,[string[]]$Expected) {
    for($column=1;$column -le $Expected.Count;$column++) {
        $actual=[string]$Sheet.Cells.Item(1,$column).Value2
        if($actual -ne $Expected[$column-1]) { throw "$($Sheet.Name) column $column expected '$($Expected[$column-1])', got '$actual'." }
    }
}

function Assert-Button($Sheet,[string]$MacroName) {
    $actions=@($Sheet.Shapes | ForEach-Object { try{$_.OnAction}catch{''} })
    if(-not ($actions | Where-Object { $_ -like "*$MacroName" })) { throw "$($Sheet.Name) button is missing $MacroName." }
}

function Assert-NoValidation($Range,[string]$Description) {
    $validationType=$null
    try {$validationType=$Range.Validation.Type} catch {}
    if($null -ne $validationType -and [string]$validationType -ne ''){throw "$Description must not have editable validation."}
}

try {
    $excel=New-Object -ComObject Excel.Application
    $excel.Visible=$false
    $excel.DisplayAlerts=$false

    $workbook=$excel.Workbooks.Open($productPath,0,$true)
    $sheets=@($workbook.Worksheets | ForEach-Object {$_.Name})
    if($sheets.Count -ne 1 -or $sheets[0] -ne 'Product') { throw "Product sheets are incorrect: $($sheets -join ',')" }
    $modules=@($workbook.VBProject.VBComponents | ForEach-Object {$_.Name})
    foreach($required in @('JsonConverter','modHttpJson','modUserMasterBridge')) {
        if($modules -notcontains $required) { throw "Product is missing $required." }
    }
    foreach($obsolete in @('modProductBridge','modCustomerBridge')) {
        if($modules -contains $obsolete) { throw "Product retained $obsolete." }
    }
    $sheet=$workbook.Worksheets.Item('Product')
    Assert-Headers $sheet @('Command','Product Code','Product Name','Weight Value','Weight Unit','Status','Result Status','Message','ID','RowVersion')
    if(-not $sheet.Columns.Item('I').Hidden -or -not $sheet.Columns.Item('J').Hidden) { throw 'Product ID/RowVersion columns are visible.' }
    if($sheet.Range('A2').Validation.Formula1 -ne 'C,U,D,N') { throw 'Product command validation is incorrect.' }
    if($sheet.Range('E2').Validation.Formula1 -ne 'g,oz') { throw 'Product weight-unit validation is incorrect.' }
    if($sheet.Range('F2').Validation.Formula1 -ne 'Active,Block') { throw 'Product status validation is incorrect.' }
    Assert-Button $sheet 'SaveProductSheet'
    Assert-Button $sheet 'RefreshProductSheet'
    Assert-Button $sheet 'PreviousProductPage'
    Assert-Button $sheet 'NextProductPage'
    $code=$workbook.VBProject.VBComponents.Item('modUserMasterBridge').CodeModule
    $source=$code.Lines(1,$code.CountOfLines)
    if($source -notlike '*ConvertToJson(payload)*') { throw 'Shared safe JSON serialization is missing.' }
    $saved=@($sheet.Range('A2:A4').Value2)
    $sheet.Range('A2').Value2='C';$sheet.Range('A3').Value2='U';$sheet.Range('A4').Value2='D'
    $message=[string]$excel.Run("'$($workbook.Name)'!UserMasterConfirmationMessage",$sheet,'Product')
    for($i=0;$i -lt 3;$i++){$sheet.Cells.Item($i+2,1).Value2=$saved[$i]}
    if($message -notlike '*Create: 1*' -or $message -notlike '*Update: 1*' -or $message -notlike '*Block: 1*' -or $message -like '*Delete is permanent.*') { throw "Product confirmation is incorrect: $message" }
    $workbook.Close($false);$workbook=$null

    $workbook=$excel.Workbooks.Open($salesPath,0,$true)
    $sheets=@($workbook.Worksheets | ForEach-Object {$_.Name})
    foreach($required in @('Customer','Opportunity','_Lookups')) { if($sheets -notcontains $required){throw "Sales is missing $required."} }
    $modules=@($workbook.VBProject.VBComponents | ForEach-Object {$_.Name})
    foreach($required in @('JsonConverter','modHttpJson','modUserMasterBridge','modUnifiedOpportunityBridge')) {
        if($modules -notcontains $required) { throw "Sales is missing $required." }
    }
    foreach($obsolete in @('modProductBridge','modCustomerBridge')) {
        if($modules -contains $obsolete) { throw "Sales retained $obsolete." }
    }
    $sheet=$workbook.Worksheets.Item('Customer')
    Assert-Headers $sheet @('Command','Customer Name','Market Code','Currency Code','Status (Update only: Active/Block)','Result Status','Message','Customer ID','Market ID','Currency ID','RowVersion')
    foreach($column in @('H','I','J','K')) { if(-not $sheet.Columns.Item($column).Hidden){throw "Customer $column should be hidden."} }
    if($sheet.Range('A2').Validation.Formula1 -ne 'C,U,D,N') { throw 'Customer command validation is incorrect.' }
    if($sheet.Range('C2').Validation.Formula1 -ne '=CustomerMarketCodes') { throw 'Customer Market validation is incorrect.' }
    if($sheet.Range('D2').Validation.Formula1 -ne '=CustomerCurrencyCodes') { throw 'Customer Currency validation is incorrect.' }
    Assert-Button $sheet 'SaveCustomerSheet'
    Assert-Button $sheet 'RefreshCustomerSheet'
    Assert-Button $sheet 'PreviousCustomerPage'
    Assert-Button $sheet 'NextCustomerPage'
    Assert-Button $workbook.Worksheets.Item('Opportunity') 'SaveUnifiedOpportunity'
    Assert-Button $workbook.Worksheets.Item('Opportunity') 'RefreshUnifiedOpportunity'
    Assert-Button $workbook.Worksheets.Item('Opportunity') 'PreviousOpportunityPage'
    Assert-Button $workbook.Worksheets.Item('Opportunity') 'NextOpportunityPage'
    Assert-Headers $workbook.Worksheets.Item('Opportunity') @('Header Command','Opportunity Number','Customer Name','Opportunity Desc','Bid Open','Bid Close','Header Stage','Item Command','Product Code','Item Description','Annual Unit','Estimated % Awarded','Shelf Price','Item Stage','Status','Message','Header ID','Header RowVersion','Item ID','Item RowVersion','Customer ID','Product ID')
    if($workbook.Worksheets.Item('Opportunity').Range('H2').Validation.Formula1 -ne 'C,U,D,N') { throw 'Opportunity Item Command validation is not in column H.' }
    Assert-NoValidation $workbook.Worksheets.Item('Opportunity').Range('G2') 'Opportunity Header Stage'
    Assert-NoValidation $workbook.Worksheets.Item('Opportunity').Range('N2') 'Opportunity Item Stage'
    if($workbook.Worksheets.Item('Opportunity').ProtectContents) { throw 'Opportunity sheet must remain unprotected for user interaction.' }
    $saved=@($sheet.Range('A2:A4').Value2)
    $sheet.Range('A2').Value2='C';$sheet.Range('A3').Value2='U';$sheet.Range('A4').Value2='D'
    $message=[string]$excel.Run("'$($workbook.Name)'!UserMasterConfirmationMessage",$sheet,'Customer')
    for($i=0;$i -lt 3;$i++){$sheet.Cells.Item($i+2,1).Value2=$saved[$i]}
    if($message -notlike '*Create: 1*' -or $message -notlike '*Update: 1*' -or $message -notlike '*Block: 1*') { throw "Customer confirmation is incorrect: $message" }

    $opportunitySource=$workbook.VBProject.VBComponents.Item('modUnifiedOpportunityBridge').CodeModule
    $opportunitySource=$opportunitySource.Lines(1,$opportunitySource.CountOfLines)
    if($opportunitySource -like '*Sheets("Product")*') { throw 'Opportunity still depends on the removed Product sheet.' }
    if($opportunitySource -notlike '*/api/opportunity/lookups*') { throw 'Opportunity does not use the complete master lookup endpoint.' }
    if($opportunitySource -like '*""Stage"":*') { throw 'Opportunity Excel payload still sends workflow stages.' }
    if($opportunitySource -notlike '*PreviousOpportunityPage*' -or $opportunitySource -notlike '*data("total")*') { throw 'Opportunity paging controls are incomplete.' }
    if($workbook.Worksheets.Item('Opportunity').Range('C2').Validation.Formula1 -ne '=OpportunityCustomerNames') { throw 'Opportunity Customer validation is incorrect.' }
    if($workbook.Worksheets.Item('Opportunity').Range('I2').Validation.Formula1 -ne '=OpportunityProductCodes') { throw 'Opportunity Product validation is incorrect.' }

    $httpCode=$workbook.VBProject.VBComponents.Item('modHttpJson').CodeModule
    $httpSource=$httpCode.Lines(1,$httpCode.CountOfLines)
    if($httpSource -notlike '*SetTimeouts*') { throw 'HTTP timeout policy is missing.' }
    if($httpSource -notlike '*REQUIRED_CONTRACT_VERSION*') { throw 'Workbook/server contract check is missing.' }

    'PASS: Product and Customer User Master workbook contracts'
}
finally {
    if($null -ne $workbook){$workbook.Close($false)}
    if($null -ne $excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)}
}
