[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9.-]+$')]
    [string]$HostName,

    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$UserName = 'root',

    [string]$IdentityFile = "$HOME\.ssh\codex_infinite_canvas_ed25519",

    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$Commit = '',

    [ValidateSet('safe', 'fast')]
    [string]$Mode = 'safe',

    [ValidateRange(1, 65535)]
    [int]$Port = 22,

    [string]$HealthUrl = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $Commit) {
    $Commit = (git rev-parse HEAD).Trim()
}
if ($Commit -notmatch '^[0-9a-f]{40}$') {
    throw 'Commit must be a full lowercase Git commit SHA.'
}
if (-not (Test-Path -LiteralPath $IdentityFile)) {
    throw "SSH identity file not found: $IdentityFile"
}

$gitPath = (Get-Command git -ErrorAction Stop).Source
$gitRoot = Split-Path (Split-Path $gitPath -Parent) -Parent
$sshPath = Join-Path $gitRoot 'usr\bin\ssh.exe'
if (-not (Test-Path -LiteralPath $sshPath)) {
    throw "Git SSH client not found: $sshPath"
}

$rawBase = "https://raw.githubusercontent.com/zdtzn/infinite-canvas/$Commit/ops"
$remoteDirectory = '/root/infinite-canvas-ops'
$remoteCommand = "set -eu; mkdir -p $remoteDirectory; curl -fsSL $rawBase/deploy-commit.sh -o $remoteDirectory/deploy-commit.sh; curl -fsSL $rawBase/deploy-pinned.sh -o $remoteDirectory/deploy-pinned.sh; chmod 700 $remoteDirectory/deploy-commit.sh $remoteDirectory/deploy-pinned.sh; EXPECTED_COMMIT=$Commit DEPLOY_MODE=$Mode sh $remoteDirectory/deploy-commit.sh"
$sshArguments = @(
    '-i', $IdentityFile,
    '-p', [string]$Port,
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'ConnectTimeout=8',
    "$UserName@$HostName",
    $remoteCommand
)

& $sshPath @sshArguments
if ($LASTEXITCODE -ne 0) {
    throw "Remote deployment failed with SSH exit code $LASTEXITCODE."
}

if (-not $HealthUrl) {
    $HealthUrl = "http://${HostName}:3000/health"
}
$health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 15
if ($health.status -ne 'ok' -or $health.commit -ne $Commit -or $health.checks.database -ne 'ok') {
    throw "Deployment health verification failed for commit $Commit."
}

Write-Output "Deployment verified: $Commit"
