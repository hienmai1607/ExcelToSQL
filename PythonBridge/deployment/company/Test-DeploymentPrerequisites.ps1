[CmdletBinding()]
param(
    [string]$PythonExe = 'python',
    [string]$SqlCmd = 'sqlcmd',
    [string]$RequiredOdbcDriver = 'ODBC Driver 18 for SQL Server'
)

$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$failures = [System.Collections.Generic.List[string]]::new()

function Test-CommandAvailable {
    param([string]$Command, [string]$Description)
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        $failures.Add("Missing ${Description}: $Command")
        return $false
    }
    return $true
}

Write-Host 'Checking company deployment prerequisites...'

if (Test-CommandAvailable -Command $PythonExe -Description 'Python executable') {
    & $PythonExe --version
    if ($LASTEXITCODE -ne 0) { $failures.Add('Python could not be executed.') }
}

[void](Test-CommandAvailable -Command $SqlCmd -Description 'Microsoft sqlcmd')

try {
    $installedDrivers = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers'
    if ($installedDrivers.$RequiredOdbcDriver -ne 'Installed') { throw 'Driver is not registered.' }
    Write-Host "ODBC driver: $RequiredOdbcDriver"
}
catch {
    $failures.Add("Missing 64-bit ODBC driver: $RequiredOdbcDriver")
}

$requiredFiles = @(
    'requirements.txt',
    'requirements.lock.txt',
    'core\main.py',
    'core\db.py',
    'core\auth.py',
    'Admin_Master.xlsm',
    'Product_Template.xlsm',
    'Sales_Template.xlsm',
    'deployment\company\migration-manifest.json',
    'sql\deploy\000_empty_database_baseline.sql',
    'sql\deploy\900_verify_deployment.sql'
)
foreach ($relativePath in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $packageRoot $relativePath))) {
        $failures.Add("Missing release file: $relativePath")
    }
}

if ($failures.Count -gt 0) {
    Write-Host ''
    $failures | ForEach-Object { Write-Error $_ }
    throw "Prerequisite check failed with $($failures.Count) problem(s)."
}

Write-Host 'All local prerequisite checks passed.'
