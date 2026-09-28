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
. "$PSScriptRoot/deploy-health.ps1"
$headCommit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $headCommit -ne $Commit) {
    throw "The checked-out commit must match the deployment commit: $Commit"
}
& git -C $repoRoot diff --quiet -- ops/deploy-commit.sh ops/deploy-pinned.sh ops/deploy-remote.ps1 ops/deploy-mode.ps1 ops/deploy-runtime.sh ops/deploy-health.ps1
if ($LASTEXITCODE -ne 0 -and -not $PlanOnly) {
    throw 'Deployment scripts contain uncommitted changes.'
}
& git -C $repoRoot diff --cached --quiet -- ops/deploy-commit.sh ops/deploy-pinned.sh ops/deploy-remote.ps1 ops/deploy-mode.ps1 ops/deploy-runtime.sh ops/deploy-health.ps1
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

# Isolate uploads so another release cannot overwrite a script being executed.
$remoteDirectory = '/root/infinite-canvas-ops/' + $Commit + '-' + [Guid]::NewGuid().ToString('N')
$remoteTarget = "$UserName@$HostName"
$revision = & $sshPath -i $IdentityFile -p $Port -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=8 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 $remoteTarget 'docker inspect -f ''{{index .Config.Labels "org.opencontainers.image.revision"}}'' infinite-canvas'
if ($LASTEXITCODE -ne 0) { throw 'Cannot read the live deployment revision; no deployment was attempted.' }
$onlineCommit = ($revision -join '').Trim()
if ($onlineCommit -notmatch '^[0-9a-f]{40}$') { throw 'The live revision is unknown; no deployment was attempted.' }
if ($Mode -eq 'auto') {
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
    foreach ($scriptName in @('deploy-commit.sh', 'deploy-pinned.sh', 'deploy-runtime.sh')) {
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
        '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=3',
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
        '-o', 'ConnectTimeout=8',
        '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=3'
    )
    $scpArguments += $normalizedScripts
    $scpArguments += "${remoteTarget}:$remoteDirectory/"
    & $scpPath @scpArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Deployment script upload failed with SCP exit code $LASTEXITCODE."
    }

    $cleanup = "rm -f $remoteDirectory/deploy-commit.sh $remoteDirectory/deploy-pinned.sh $remoteDirectory/deploy-runtime.sh; rmdir $remoteDirectory"
    $remoteCommand = "set -eu; trap '$cleanup' EXIT; chmod 700 $remoteDirectory/deploy-commit.sh $remoteDirectory/deploy-pinned.sh; EXPECTED_LIVE_COMMIT=$onlineCommit EXPECTED_COMMIT=$Commit IMAGE_TAG=$Commit DEPLOY_MODE=$Mode REQUIRE_HTTPS=$requireHttps sh $remoteDirectory/deploy-commit.sh"
    $deployArguments = @(
        '-i', $IdentityFile,
        '-p', [string]$Port,
        '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes',
        '-o', 'ConnectTimeout=8',
        '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=3',
        $remoteTarget,
        $remoteCommand
    )
    & $sshPath @deployArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Remote deployment command did not complete successfully (SSH exit $LASTEXITCODE). Inspect the remote result and current health before retrying; the command will not be repeated automatically."
    }
} finally {
    if ((Test-Path -LiteralPath $tempDirectory) -and $tempDirectory.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Confirm-DeploymentHealth -HealthUrl $HealthUrl -Commit $Commit
