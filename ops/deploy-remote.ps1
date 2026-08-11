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

$repoRoot = Split-Path $PSScriptRoot -Parent
$headCommit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $headCommit -ne $Commit) {
    throw "The checked-out commit must match the deployment commit: $Commit"
}
& git -C $repoRoot diff --quiet -- ops/deploy-commit.sh ops/deploy-pinned.sh ops/deploy-remote.ps1
if ($LASTEXITCODE -ne 0) {
    throw 'Deployment scripts contain uncommitted changes.'
}
& git -C $repoRoot diff --cached --quiet -- ops/deploy-commit.sh ops/deploy-pinned.sh ops/deploy-remote.ps1
if ($LASTEXITCODE -ne 0) {
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
