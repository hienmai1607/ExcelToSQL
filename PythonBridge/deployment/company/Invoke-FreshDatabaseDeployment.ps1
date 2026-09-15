[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)]
    [string]$ServerInstance,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9_]+$')]
    [string]$Database,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._@\\-]+$')]
    [string]$BootstrapUserName,

    [string]$SqlCmd = 'sqlcmd',
    [switch]$TrustServerCertificate,
    [switch]$NoEncrypt
)

$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$manifestPath = Join-Path $PSScriptRoot 'migration-manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

if (-not (Get-Command $SqlCmd -ErrorAction SilentlyContinue)) {
    throw "sqlcmd was not found. Install Microsoft sqlcmd and retry."
}

function New-SqlCmdArguments {
    param([string[]]$Additional)
    $arguments = @('-S', $ServerInstance, '-d', $Database, '-E', '-b', '-r', '1')
    if (-not $NoEncrypt) { $arguments += '-N' }
    if ($TrustServerCertificate) { $arguments += '-C' }
    return $arguments + $Additional
}

function Invoke-SqlCmdChecked {
    param([string[]]$Additional)
    & $SqlCmd @(New-SqlCmdArguments -Additional $Additional)
    if ($LASTEXITCODE -ne 0) {
        throw "sqlcmd failed with exit code $LASTEXITCODE."
    }
}

$countOutput = & $SqlCmd @(New-SqlCmdArguments -Additional @(
    '-h', '-1', '-W', '-Q',
    "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.tables WHERE schema_id=SCHEMA_ID(N'dbo');"
))
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the target database.' }
$applicationTableCount = [int](($countOutput | Where-Object { $_ -match '^\s*\d+\s*$' } | Select-Object -First 1).Trim())
if ($applicationTableCount -ne 0) {
    throw "Target database is not empty. This fresh-install runner will not modify it. Use an approved upgrade migration instead."
}

$target = "$ServerInstance / $Database"
if (-not $PSCmdlet.ShouldProcess($target, "Install bridge database release $($manifest.release) and bootstrap $BootstrapUserName")) {
    return
}

foreach ($entry in $manifest.scripts) {
    $sourcePath = (Resolve-Path (Join-Path $packageRoot $entry.path)).Path
    $executionPath = $sourcePath
    $temporaryFile = $null
    try {
        if ($entry.stripDevelopmentUse) {
            $temporaryFile = New-TemporaryFile
            $content = Get-Content -LiteralPath $sourcePath -Raw
            $content = [regex]::Replace(
                $content,
                '(?im)^\s*USE\s+\[test\]\s*\r?\n\s*GO\s*\r?\n?',
                ''
            )
            Set-Content -LiteralPath $temporaryFile.FullName -Value $content -Encoding UTF8
            $executionPath = $temporaryFile.FullName
        }

        Write-Host "Applying $($entry.id)..."
        Invoke-SqlCmdChecked -Additional @('-i', $executionPath)

        if ($entry.id -ne '000_empty_database_baseline') {
            $safeID = $entry.id -replace "'", "''"
            Invoke-SqlCmdChecked -Additional @(
                '-Q',
                "IF NOT EXISTS(SELECT 1 FROM dbo.BridgeDeploymentHistory WHERE DeploymentID=N'$safeID') INSERT dbo.BridgeDeploymentHistory(DeploymentID) VALUES(N'$safeID');"
            )
        }
    }
    finally {
        if ($null -ne $temporaryFile -and (Test-Path -LiteralPath $temporaryFile.FullName)) {
            Remove-Item -LiteralPath $temporaryFile.FullName -Force
        }
    }
}

$bootstrapScript = Join-Path $packageRoot 'sql\deploy\010_bootstrap_admin.sql'
Invoke-SqlCmdChecked -Additional @('-v', "BootstrapUserName=$BootstrapUserName", '-i', $bootstrapScript)

$verificationScript = Join-Path $packageRoot 'sql\deploy\900_verify_deployment.sql'
Invoke-SqlCmdChecked -Additional @('-i', $verificationScript)

Write-Host "Fresh database deployment completed successfully for $target."
