# Shared by workbook maintenance scripts. Backups stay beside the source
# workbook in backups/, with unique names so previous recovery copies survive.
function Install-SharedPagination {
    param($Workbook)
    $component=$null
    try{$component=$Workbook.VBProject.VBComponents.Item('modPagination')}catch{}
    if($null -ne $component){$Workbook.VBProject.VBComponents.Remove($component)}
    [void]$Workbook.VBProject.VBComponents.Import((Join-Path (Split-Path $PSScriptRoot -Parent) 'modPagination.bas'))
}

function New-WorkbookBackup {
    param([Parameter(Mandatory=$true)][string]$WorkbookPath)
    $source=(Resolve-Path -LiteralPath $WorkbookPath).Path
    $folder=Join-Path (Split-Path $source -Parent) 'backups'
    [void](New-Item -ItemType Directory -Path $folder -Force)
    $name=[IO.Path]::GetFileNameWithoutExtension($source)
    $suffix=(Get-Date -Format 'yyyyMMdd-HHmmssfff')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
    $destination=Join-Path $folder ($name+'.before_update_'+$suffix+'.xlsm')
    Copy-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
    return $destination
}
