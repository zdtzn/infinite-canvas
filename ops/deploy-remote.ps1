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

    [ValidateSet('auto', 'safe', 'fast')]
    [string]$Mode = 'auto',

    [ValidateRange(1, 65535)]
    [int]$Port = 22,

    [string]$HealthUrl = '',

    [switch]$PlanOnly
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

$repoRoot = Split-Path $PSScriptRoot -Parent
. "$PSScriptRoot/deploy-mode.ps1"
$headCommit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $headCommit -ne $Commit) {
    throw "The checked-out commit must match the deployment commit: $Commit"
}
& git -C $repoRoot diff --quiet -- ops/deploy-commit.sh ops/deploy-pinned.sh ops/deploy-remote.ps1 ops/deploy-mode.ps1
if ($LASTEXITCODE -ne 0 -and -not $PlanOnly) {
    throw 'Deployment scripts contain uncommitted changes.'
}
& git -C $repoRoot diff --cached --quiet -- ops/deploy-commit.sh ops/deploy-pinned.sh ops/deploy-remote.ps1 ops/deploy-mode.ps1
if ($LASTEXITCODE -ne 0 -and -not $PlanOnly) {
    throw 'Deployment scripts contain staged changes that are not in the deployment commit.'
}

$gitPath = (Get-Command git -ErrorAction Stop).Source
$gitRoot = Split-Path (Split-Path $gitPath -Parent) -Parent
$sshPath = Join-Path $gitRoot 'usr\bin\ssh.exe'
$scpPath = Join-Path $gitRoot 'usr\bin\scp.exe'
if (-not (Test-Path -LiteralPath $sshPath)) {
    throw "Git SSH client not found: $sshPath"
}
if (-not (Test-Path -LiteralPath $scpPath)) {
    throw "Git SCP client not found: $scpPath"
}

if (-not $HealthUrl) {
    $HealthUrl = "http://${HostName}:3000/health"
}
$healthUri = $null
if (-not ([Uri]::TryCreate($HealthUrl, [UriKind]::Absolute, [ref]$healthUri)) -or $healthUri.Scheme -notin @('http', 'https')) {
    throw "HealthUrl must be an absolute HTTP or HTTPS URL: $HealthUrl"
}
$requireHttps = if ($healthUri.Scheme -eq 'https') { '1' } else { '0' }

$remoteDirectory = '/root/infinite-canvas-ops'
$remoteTarget = "$UserName@$HostName"
$onlineCommit = ''
if ($Mode -eq 'auto') {
    $revision = & $sshPath -i $IdentityFile -p $Port -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=8 $remoteTarget 'docker inspect -f ''{{index .Config.Labels "org.opencontainers.image.revision"}}'' infinite-canvas'
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read the live deployment revision; no deployment was attempted.' }
    $onlineCommit = ($revision -join '').Trim()
    $Mode = 'safe'
    if ($onlineCommit -match '^[0-9a-f]{40}$') {
        & git -C $repoRoot merge-base --is-ancestor $onlineCommit $Commit 2>$null
        if ($LASTEXITCODE -eq 0) {
            # --no-renames includes both old and new paths so a move cannot hide a risky deletion.
            $changedPaths = @(& git -C $repoRoot diff --name-only --no-renames $onlineCommit $Commit)
            if ($LASTEXITCODE -eq 0) { $Mode = Get-AutomaticDeploymentMode -ChangedPaths $changedPaths }
        }
    }
    Write-Output "Automatic deployment: live=$onlineCommit target=$Commit mode=$Mode"
}
if ($PlanOnly) {
    Write-Output "Plan only: mode=$Mode; no upload, backup or container restart performed."
    return
}
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempDirectory = Join-Path $tempRoot ("infinite-canvas-deploy-" + [Guid]::NewGuid().ToString('N'))
$normalizedScripts = @()

try {
    New-Item -ItemType Directory -Path $tempDirectory -ErrorAction Stop | Out-Null
    $utf8NoBom = [Text.UTF8Encoding]::new($false)
    foreach ($scriptName in @('deploy-commit.sh', 'deploy-pinned.sh')) {
        $sourcePath = Join-Path $PSScriptRoot $scriptName
        if (-not (Test-Path -LiteralPath $sourcePath)) {
            throw "Deployment script not found: $sourcePath"
        }
        $targetPath = Join-Path $tempDirectory $scriptName
        $content = [IO.File]::ReadAllText($sourcePath).Replace("`r`n", "`n").Replace("`r", "`n")
        [IO.File]::WriteAllText($targetPath, $content, $utf8NoBom)
        $normalizedScripts += $targetPath
    }

    $prepareArguments = @(
        '-i', $IdentityFile,
        '-p', [string]$Port,
        '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes',
        '-o', 'ConnectTimeout=8',
        $remoteTarget,
        "set -eu; mkdir -p $remoteDirectory; chmod 700 $remoteDirectory"
    )
    & $sshPath @prepareArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Remote deployment preparation failed with SSH exit code $LASTEXITCODE."
    }

    $scpArguments = @(
        '-i', $IdentityFile,
        '-P', [string]$Port,
        '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes',
        '-o', 'ConnectTimeout=8'
    )
    $scpArguments += $normalizedScripts
    $scpArguments += "${remoteTarget}:$remoteDirectory/"
    & $scpPath @scpArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Deployment script upload failed with SCP exit code $LASTEXITCODE."
    }

    $remoteCommand = "set -eu; chmod 700 $remoteDirectory/deploy-commit.sh $remoteDirectory/deploy-pinned.sh; EXPECTED_COMMIT=$Commit IMAGE_TAG=$Commit DEPLOY_MODE=$Mode REQUIRE_HTTPS=$requireHttps sh $remoteDirectory/deploy-commit.sh"
    if ($Mode -eq 'fast' -and $onlineCommit) {
        # Do not use a stale fast-mode decision if another deployment has intervened.
        $guard = 'test "$(docker inspect -f ''{{index .Config.Labels "org.opencontainers.image.revision"}}'' infinite-canvas)" = "' + $onlineCommit + '" || { echo "Live revision changed; rerun deployment" >&2; exit 1; }; '
        $remoteCommand = $guard + $remoteCommand
    }
    $deployArguments = @(
        '-i', $IdentityFile,
        '-p', [string]$Port,
        '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes',
        '-o', 'ConnectTimeout=8',
        $remoteTarget,
        $remoteCommand
    )
    & $sshPath @deployArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Remote deployment failed with SSH exit code $LASTEXITCODE."
    }
} finally {
    if ((Test-Path -LiteralPath $tempDirectory) -and $tempDirectory.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 15
if ($health.status -ne 'ok' -or $health.commit -ne $Commit -or $health.checks.database -ne 'ok') {
    throw "Deployment health verification failed for commit $Commit."
}

Write-Output "Deployment verified: $Commit"
