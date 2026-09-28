$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/deploy-health.ps1"
$script:target = '1111111111111111111111111111111111111111'
function Start-Sleep { param($Seconds) }
function Invoke-RestMethod {
    param($Uri, $TimeoutSec, $ErrorAction)
    if ($TimeoutSec -ne 10) { throw 'Unexpected request timeout' }
    $script:requests++
    if ($script:scenario -eq 'offline' -or ($script:scenario -eq 'transient' -and $script:requests -eq 1)) { throw 'Simulated transport failure' }
    return @{
        status = 'ok'
        commit = if ($script:scenario -eq 'wrong-revision') { 'old' } else { $script:target }
        checks = @{ database = if ($script:scenario -eq 'database-error') { 'error' } else { 'ok' } }
    }
}

foreach ($case in @(
    @{ Name = 'healthy'; Calls = 1; Success = $true },
    @{ Name = 'transient'; Calls = 2; Success = $true },
    @{ Name = 'wrong-revision'; Calls = 3; Success = $false },
    @{ Name = 'database-error'; Calls = 3; Success = $false },
    @{ Name = 'offline'; Calls = 3; Success = $false }
)) {
    $script:scenario = $case.Name
    $script:requests = 0
    $succeeded = $false
    try {
        $null = Confirm-DeploymentHealth -HealthUrl 'https://example.invalid/health' -Commit $script:target 3>$null
        $succeeded = $true
    } catch {
        if ($_.Exception.Message -notlike 'Remote deployment completed*public verification remains unconfirmed*') { throw }
    }
    if ($succeeded -ne $case.Success -or $script:requests -ne $case.Calls) { throw "Unexpected result: $($case.Name)" }
}
Write-Output '5 public-health retry cases passed (mock HTTP; no deployment).'
