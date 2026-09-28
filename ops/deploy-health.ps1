function Confirm-DeploymentHealth {
    param(
        [Parameter(Mandatory = $true)][string]$HealthUrl,
        [Parameter(Mandatory = $true)][string]$Commit
    )

    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 10 -ErrorAction Stop
            if ($health.status -eq 'ok' -and $health.commit -eq $Commit -and $health.checks.database -eq 'ok') {
                Write-Output "Deployment verified: $Commit"
                return
            }
            $reason = 'The public endpoint did not confirm the expected healthy revision and database.'
        } catch {
            # Avoid emitting request headers, credentials, or arbitrary server bodies.
            $reason = 'The public health request failed or returned an invalid response.'
        }
        if ($attempt -lt 3) {
            Write-Warning "$reason Retrying public verification ($attempt/3); no deployment will be repeated."
            Start-Sleep -Seconds 2
        }
    }
    throw "Remote deployment completed for $Commit, but public verification remains unconfirmed after 3 attempts. Check $HealthUrl before considering another deployment. $reason"
}
