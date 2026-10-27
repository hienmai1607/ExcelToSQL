[CmdletBinding()]
param(
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $PSScriptRoot 'release-files.sha256'
}
$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$patterns = @(
    'core\*.py', 'sql\*.sql', 'sql\deploy\*.sql',
    'deployment\company\*.ps1', 'deployment\company\*.json',
    'deployment\company\*.md', 'docs\*.md', '*.bas',
    'Admin_Master.xlsm', 'Product_Template.xlsm', 'Sales_Template.xlsm',
    'requirements.txt', 'requirements.lock.txt', '.env.example', '.gitignore', 'README.md',
    'webapp\dist\index.html', 'webapp\dist\assets\*', 'templates\*.xlsm',
    'scripts\Build-VMUpgrade117To137.ps1', 'scripts\Build-VMUpgrade138To141.ps1', 'scripts\Build-VMUpgrade142To143.ps1', 'scripts\Build-VMUpgrade142To144.ps1', 'scripts\Build-VMUpgrade142To145.ps1', 'scripts\Build-VMUpgrade142To146.ps1', 'scripts\Build-VMUpgrade142To147.ps1'
)

$files = foreach ($pattern in $patterns) {
    Get-ChildItem -Path (Join-Path $packageRoot $pattern) -File -ErrorAction SilentlyContinue
}
$files = $files | Sort-Object FullName -Unique

$rows = foreach ($file in $files) {
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $relative = $file.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
    "$hash  $relative"
}

Set-Content -LiteralPath $OutputPath -Value $rows -Encoding UTF8
Write-Host "Wrote $($rows.Count) checksums to $OutputPath"
