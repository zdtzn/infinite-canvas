$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/deploy-mode.ps1"
$cases = @(
    @{ Paths = @('web/src/features/cultivation/imperial-identity.css', 'CHANGELOG.md'); Expected = 'fast' },
    @{ Paths = @('web/public/realm.webp', 'docs/progress.md'); Expected = 'fast' },
    @{ Paths = @('web/src/style.css', 'server/index.ts'); Expected = 'safe' },
    @{ Paths = @('web/src/status-pill.tsx'); Expected = 'safe' },
    @{ Paths = @('web/src/stores/preferences.ts'); Expected = 'safe' },
    @{ Paths = @('web/bun.lock'); Expected = 'safe' },
    @{ Paths = @('ops/deploy-pinned.sh'); Expected = 'safe' },
    @{ Paths = @('docs/Dockerfile'); Expected = 'safe' },
    @{ Paths = @('.github/workflows/docker-image.yml'); Expected = 'safe' },
    @{ Paths = @('web/public/runtime.js'); Expected = 'safe' },
    @{ Paths = @(); Expected = 'safe' }
)
foreach ($case in $cases) {
    $actual = Get-AutomaticDeploymentMode -ChangedPaths $case.Paths
    if ($actual -ne $case.Expected) { throw "Incorrect mode for $($case.Paths): $actual" }
}
Write-Output "$($cases.Count) deployment-mode cases passed."
