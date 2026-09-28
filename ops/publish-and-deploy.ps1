#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$HostName,
    [string]$HealthUrl = '',
    [string]$IdentityFile = "$HOME\.ssh\codex_infinite_canvas_ed25519",
    [ValidateRange(1, 60)]
    [int]$CiTimeoutMinutes = 15,
    [switch]$PlanOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$timer = [Diagnostics.Stopwatch]::StartNew()

function Write-Stage([string]$Message) {
    Write-Host ("[{0:mm\:ss}] {1}" -f $timer.Elapsed, $Message)
}

function Read-GitHubJson([string]$Url) {
    # The repository is public; do not read or print account credentials.
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        $json = & curl.exe --fail --silent --show-error --connect-timeout 8 --max-time 15 `
            -H 'User-Agent: Infinite-Canvas-Release' -H 'Accept: application/vnd.github+json' $Url
        if ($LASTEXITCODE -eq 0) { return ($json -join "`n") | ConvertFrom-Json }
        if ($attempt -lt 2) { Start-Sleep -Seconds 2 }
    }
    throw 'GitHub API request failed twice. No deployment was started; rerun after connectivity recovers.'
}

$branch = & git -C $repoRoot branch --show-current
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'Release from the main branch only.' }
$pending = & git -C $repoRoot status --porcelain
if ($LASTEXITCODE -ne 0) { throw 'Cannot read the working tree status.' }
if ($pending -and -not $PlanOnly) { throw 'Commit the intended changes and leave a clean working tree before publishing.' }
$commit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'Cannot determine the release commit.' }
$origin = & git -C $repoRoot remote get-url origin
if ($LASTEXITCODE -ne 0 -or $origin -notmatch '^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$') {
    throw 'Expected an HTTPS GitHub origin without embedded credentials.'
}
$repository = "$($Matches[1])/$($Matches[2])"
$api = "https://api.github.com/repos/$repository"

Write-Stage "Release target: $repository main $commit"
if ($PlanOnly) {
    if ($pending) { Write-Stage 'Uncommitted changes exist; the real release will require a clean committed checkout.' }
    Write-Stage "Plan: push -> wait for Docker image CI (up to ${CiTimeoutMinutes}m) -> deploy in auto mode -> verify public health. No actions performed."
    return
}

# Prefer the transport that succeeded on this Windows workstation. Never force-push.
Write-Stage 'Pushing the committed revision'
for ($attempt = 1; $attempt -le 2; $attempt++) {
    & git -C $repoRoot -c http.version=HTTP/2 -c http.lowSpeedLimit=1 -c http.lowSpeedTime=30 push origin "${commit}:refs/heads/main"
    if ($LASTEXITCODE -eq 0) { break }
    if ($attempt -eq 2) { throw 'Push failed twice. No deployment was started. Inspect the reported Git error before retrying.' }
    Start-Sleep -Seconds 3
}

$ciTimer = [Diagnostics.Stopwatch]::StartNew()
$lastState = ''
while ($true) {
    if ($ciTimer.Elapsed.TotalMinutes -ge $CiTimeoutMinutes) {
        throw "CI wait exceeded ${CiTimeoutMinutes}m. The current server was not changed; inspect GitHub Actions and rerun this command."
    }
    $response = Read-GitHubJson "$api/actions/workflows/docker-image.yml/runs?head_sha=$commit&event=push&per_page=10"
    $run = @($response.workflow_runs | Where-Object { $_.head_sha -eq $commit -and $_.head_branch -eq 'main' } | Sort-Object run_number -Descending | Select-Object -First 1)
    if ($run.Count -eq 0) {
        $state = 'Waiting for the matching CI run to appear'
    } else {
        $run = $run[0]
        $state = "CI $($run.status): $($run.html_url)"
        if ($run.status -eq 'completed') {
            if ($run.conclusion -ne 'success') { throw "CI ended with $($run.conclusion). No deployment was started. $($run.html_url)" }
            Write-Stage "CI and image publication succeeded: $($run.html_url)"
            break
        }
    }
    # Print a bounded heartbeat so queued/building work never looks silently stuck.
    if ($state -ne $lastState) { Write-Stage $state; $lastState = $state }
    else { Write-Stage 'Still waiting for CI; the current server remains running' }
    Start-Sleep -Seconds 20
}

# A later release must not be overwritten by a stale command waiting on CI.
$remoteHead = Read-GitHubJson "$api/git/ref/heads/main"
if ($remoteHead.object.sha -ne $commit) { throw 'Remote main advanced while waiting. Rerun from the new main revision.' }
$currentHead = & git -C $repoRoot rev-parse HEAD
$pending = & git -C $repoRoot status --porcelain
if ($LASTEXITCODE -ne 0 -or $currentHead -ne $commit -or $pending) { throw 'The local checkout changed while waiting. No deployment was started.' }

Write-Stage 'Starting remote deployment (pull, backup when required, switch, health verification)'
& "$PSScriptRoot/deploy-remote.ps1" -HostName $HostName -HealthUrl $HealthUrl -IdentityFile $IdentityFile -Commit $commit -Mode auto
Write-Stage "Release completed and verified: $commit"
