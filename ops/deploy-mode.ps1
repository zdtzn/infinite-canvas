function Get-AutomaticDeploymentMode {
    param([string[]]$ChangedPaths)

    # Unknown/empty diffs fail closed. Code and configuration require review.
    if (-not $ChangedPaths -or $ChangedPaths.Count -eq 0) { return 'safe' }
    foreach ($path in $ChangedPaths) {
        if ($path -cmatch '^(CHANGELOG\.md|README\.md|docs/.*\.(md|mdx)|web/src/.*\.css|web/public/.*\.(png|jpg|jpeg|webp|avif|ico|woff|woff2))$') { continue }
        return 'safe'
    }
    return 'fast'
}
