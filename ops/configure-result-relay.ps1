[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^https://[A-Za-z0-9.-]+(?:/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*)?$')]
    [string]$WorkerUrl,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9.-]+$')]
    [string]$HostName,

    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$UserName = 'root',

    [string]$IdentityFile = "$HOME\.ssh\codex_infinite_canvas_ed25519",

    [ValidateRange(1, 65535)]
    [int]$Port = 22,

    [ValidatePattern('^/[A-Za-z0-9._/-]+$')]
    [string]$RemoteEnvironmentFile = '/root/infinite-canvas.env'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $IdentityFile)) {
    throw "SSH identity file not found: $IdentityFile"
}
if (-not $RemoteEnvironmentFile.StartsWith('/')) {
    throw 'RemoteEnvironmentFile must be an absolute path.'
}
if (($RemoteEnvironmentFile -split '/') -contains '..') {
    throw 'RemoteEnvironmentFile must not contain parent path segments.'
}

$gitPath = (Get-Command git -ErrorAction Stop).Source
$gitRoot = Split-Path (Split-Path $gitPath -Parent) -Parent
$sshPath = Join-Path $gitRoot 'usr\bin\ssh.exe'
$scpPath = Join-Path $gitRoot 'usr\bin\scp.exe'
if (-not (Test-Path -LiteralPath $sshPath) -or -not (Test-Path -LiteralPath $scpPath)) {
    throw 'Git SSH tools are required.'
}

$workerDirectory = Join-Path $PSScriptRoot 'cloudflare-result-relay'
$randomBytes = New-Object byte[] 48
$randomNumberGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $randomNumberGenerator.GetBytes($randomBytes)
}
finally {
    $randomNumberGenerator.Dispose()
}
$secret = [Convert]::ToBase64String($randomBytes)
$temporaryFile = Join-Path ([IO.Path]::GetTempPath()) ("infinite-canvas-relay-" + [Guid]::NewGuid().ToString('N') + '.env')
$remoteUpdateFile = "$RemoteEnvironmentFile.relay-update-$([Guid]::NewGuid().ToString('N'))"
$sshArguments = @(
    '-i', $IdentityFile,
    '-p', [string]$Port,
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'ConnectTimeout=8'
)
$scpArguments = @(
    '-i', $IdentityFile,
    '-P', [string]$Port,
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'ConnectTimeout=8'
)

try {
    Push-Location $workerDirectory
    try {
        $secret | & npx.cmd --yes wrangler@latest secret put RESULT_IMAGE_RELAY_SECRET
        if ($LASTEXITCODE -ne 0) {
            throw 'Unable to configure the Cloudflare Worker secret.'
        }
    }
    finally {
        Pop-Location
    }

    $content = @(
        "RESULT_IMAGE_RELAY_URL=$WorkerUrl"
        "RESULT_IMAGE_RELAY_SECRET=$secret"
        'RESULT_IMAGE_RELAY_TTL_SECONDS=120'
        'RESULT_IMAGE_RELAY_DOWNLOAD_TIMEOUT_MS=30000'
        'RESULT_IMAGE_RELAY_SERVER_DOWNLOAD=0'
        ''
    ) -join "`n"
    [IO.File]::WriteAllText($temporaryFile, $content, [Text.UTF8Encoding]::new($false))

    & $scpPath @scpArguments $temporaryFile "${UserName}@${HostName}:$remoteUpdateFile"
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to upload the server relay configuration.'
    }
    $remoteCommand = @'
set -eu
umask 077
target='{0}'
update='{1}'
temporary="${{target}}.tmp.$$"
trap 'rm -f "$temporary" "$update"' EXIT INT TERM
if [ -f "$target" ]; then
  awk -F= '$1 != "RESULT_IMAGE_RELAY_URL" && $1 != "RESULT_IMAGE_RELAY_SECRET" && $1 != "RESULT_IMAGE_RELAY_TTL_SECONDS" && $1 != "RESULT_IMAGE_RELAY_DOWNLOAD_TIMEOUT_MS" && $1 != "RESULT_IMAGE_RELAY_SERVER_DOWNLOAD" {{ print }}' "$target" > "$temporary"
else
  : > "$temporary"
fi
cat "$update" >> "$temporary"
chmod 600 "$temporary"
mv "$temporary" "$target"
rm -f "$update"
trap - EXIT INT TERM
'@ -f $RemoteEnvironmentFile, $remoteUpdateFile
    & $sshPath @sshArguments "${UserName}@${HostName}" $remoteCommand
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to merge the server relay configuration.'
    }

    Write-Output 'Worker and server relay secrets configured.'
}
finally {
    & $sshPath @sshArguments "${UserName}@${HostName}" "rm -f '$remoteUpdateFile'" 2>$null
    if (Test-Path -LiteralPath $temporaryFile) {
        Remove-Item -LiteralPath $temporaryFile -Force
    }
    $secret = $null
    [Array]::Clear($randomBytes, 0, $randomBytes.Length)
}
