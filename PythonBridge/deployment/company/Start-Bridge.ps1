[CmdletBinding()]
param(
    [string]$PythonExe = 'python',
    [ValidateRange(1, 32)]
    [int]$Workers = 4,
    [string]$BindAddress = '127.0.0.1',
    [ValidateRange(1, 65535)]
    [int]$Port = 8000,
    [ValidateSet('critical','error','warning','info','debug','trace')]
    [string]$LogLevel = 'info'
)

$ErrorActionPreference = 'Stop'
$requiredEnvironment = @('APP_ENV','AUTH_MODE','DB_SERVER','DB_NAME')
foreach ($name in $requiredEnvironment) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
        throw "$name is not configured for this service process."
    }
}
if ($env:APP_ENV -ne 'production') {
    throw 'Company service startup requires APP_ENV=production.'
}
if ($env:AUTH_MODE -ne 'trusted_proxy') {
    throw 'Company service startup currently requires AUTH_MODE=trusted_proxy.'
}
if ([string]::IsNullOrWhiteSpace($env:AUTH_PROXY_SECRET)) {
    throw 'AUTH_PROXY_SECRET is required for trusted_proxy mode.'
}

$corePath = (Resolve-Path (Join-Path $PSScriptRoot '..\..\core')).Path
Push-Location $corePath
try {
    & $PythonExe -m uvicorn main:app `
        --host $BindAddress `
        --port $Port `
        --workers $Workers `
        --log-level $LogLevel `
        --access-log
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
