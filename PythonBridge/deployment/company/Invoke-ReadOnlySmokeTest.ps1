[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^https://')]
    [string]$ApiBaseUrl,
    [string]$ExpectedContract = '2',
    [switch]$TestAdminReads
)

$ErrorActionPreference = 'Stop'
$baseUrl = $ApiBaseUrl.TrimEnd('/')

function Invoke-BridgeGet {
    param([string]$Path, [switch]$Authenticated)
    $parameters = @{
        Uri = "$baseUrl$Path"
        Method = 'GET'
        TimeoutSec = 60
        UseBasicParsing = $true
    }
    if ($Authenticated) { $parameters.UseDefaultCredentials = $true }
    $response = Invoke-WebRequest @parameters
    $contract = $response.Headers['X-Bridge-Contract']
    if ($contract -ne $ExpectedContract) {
        throw "$Path returned contract '$contract'; expected '$ExpectedContract'."
    }
    Write-Host "PASS $Path [$($response.StatusCode)] contract=$contract"
    return $response
}

$live = Invoke-BridgeGet -Path '/health/live'
$liveBody = $live.Content | ConvertFrom-Json
if ($liveBody.status -ne 'live') { throw 'Liveness response is invalid.' }

$ready = Invoke-BridgeGet -Path '/health/ready'
$readyBody = $ready.Content | ConvertFrom-Json
if ($readyBody.status -ne 'ready') { throw 'Readiness response is invalid.' }

if ($TestAdminReads) {
    [void](Invoke-BridgeGet -Path '/api/market' -Authenticated)
    [void](Invoke-BridgeGet -Path '/api/currency' -Authenticated)
    [void](Invoke-BridgeGet -Path '/api/user' -Authenticated)
    [void](Invoke-BridgeGet -Path '/api/user-access' -Authenticated)
}

Write-Host 'Read-only smoke tests passed.'
