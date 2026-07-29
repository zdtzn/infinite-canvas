# Production Deployment Notes

This deployment profile targets one Bun process, one SQLite database, and roughly ten invited users. It intentionally does not add Redis, a message broker, or Kubernetes.

## Before the Domain Is Ready

Use direct IP access only for temporary testing:

```bash
APP_BIND_ADDRESS=0.0.0.0 \
PUBLIC_BASE_URL= \
TRUST_PROXY=0 \
FORCE_SECURE_COOKIES=0 \
docker compose up -d app
```

The default bind address is `127.0.0.1`, which prevents accidental public exposure of port 3000. Direct-IP testing also requires a temporary cloud firewall rule for port 3000 and should be removed afterward. Set a stable `APP_ENCRYPTION_KEY` before storing any real provider key, even during direct-IP testing. Once the domain is ready, keep the loopback bind and use the production Compose override; it requires the public URL, encryption key, and domain and forces trusted-proxy and secure-cookie handling.

## Initialize the Administrator Before Exposure

Start only the `app` service and call `POST /api/auth/setup` from the server loopback interface with no `Origin` header. Do not expose Caddy until this one-time setup has succeeded. The exact command is documented in `docs/SECURE_PUBLIC_DEPLOYMENT.md`.

Keep `ALLOW_NEW_USERS=1` only while invited members create their accounts. Then set `ALLOW_NEW_USERS=0` and recreate the app container. Existing members can still log in. `MAX_REGISTERED_USERS` is a second guardrail and includes the administrator.

## Pin the Production Image

Do not let Watchtower deploy a moving `latest` tag. Resolve the tested GHCR digest and set:

```bash
export IMAGE_REF='ghcr.io/zdtzn/infinite-canvas@sha256:REPLACE_WITH_TESTED_DIGEST'
docker compose -f docker-compose.yml -f docker-compose.production.yml pull
docker compose --profile https -f docker-compose.yml -f docker-compose.production.yml up -d
```

The image workflow runs type checking, all tests, and the production build before publishing any image. Branch pushes build only `linux/amd64` for the production server, while version tags build both `amd64` and `arm64`. A manual workflow run can also enable the `multiarch` input. Image compilation runs in parallel with verification, but tags are published only after verification succeeds.

## Repeat Deployments Before Launch

For the current single-server workflow, deploy only after the GitHub Actions checks and image workflow have succeeded. The helper resolves the verified `latest` tag to its immutable digest before changing the running container:

```bash
sh ops/deploy-latest.sh
```

From a Windows development machine with the dedicated deployment key installed, use the remote helper. It waits until GHCR publishes the requested commit, deploys its immutable digest, and verifies the public health endpoint:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ops/deploy-remote.ps1 `
  -HostName 118.190.159.129 `
  -Commit (git rev-parse HEAD) `
  -Mode safe
```

Use `-Mode fast` only for UI, copy, and style changes. The default `safe` mode remains required for server code, authentication, permissions, provider configuration, storage, SQLite, migrations, and releases.

The deployment script stops the app briefly, creates and verifies a full-volume backup, starts the new image by digest, checks `/health` and the source revision, and restores the previous container automatically on failure. For a specific release, bypass tag resolution and provide both immutable values explicitly:

```bash
IMAGE_REF='ghcr.io/zdtzn/infinite-canvas@sha256:REPLACE_WITH_TESTED_DIGEST' \
EXPECTED_COMMIT='REPLACE_WITH_FULL_GIT_SHA' \
sh ops/deploy-pinned.sh
```

Keep `/root/infinite-canvas.env` mode `600` when production environment variables are added. The script uses that file automatically when it exists.
When only deployment settings or environment variables changed, set `FORCE_RECREATE=1` so the same pinned image is recreated safely.

During frequent pre-launch UI work, use the fast deployment command after the image workflow succeeds:

```bash
sh ops/deploy-fast.sh
```

Fast mode skips the full-volume archive and accepts the new container after `/health` reports the expected source revision. It still deploys an immutable digest and restores the previous container when startup fails. Use it only for frontend UI, copy, styles, and other changes that cannot alter persisted data. Continue using `deploy-latest.sh` for server code, authentication, permissions, provider configuration, storage, SQLite, migrations, environment changes, and every production release.

All deployment modes now refuse to stop the container while generation jobs are queued or running. Wait for those jobs to finish before deploying. `ALLOW_ACTIVE_JOBS=1` is an emergency override and may cause a paid synchronous upstream request to finish without its result being recoverable, so it should not be used during normal updates.

## Required Secrets

Keep these in a root-readable environment file outside the repository:

```dotenv
PUBLIC_BASE_URL=https://your-domain.example
APP_ENCRYPTION_KEY=replace-with-at-least-32-random-bytes
TRUST_PROXY=1
FORCE_SECURE_COOKIES=1
```

Back up `APP_ENCRYPTION_KEY` separately. Database and channel backups are unusable without the key.

## Backups

The built-in scheduled backup contains SQLite only. It is useful for quick database recovery, but it does not contain assets, job files, or reference files.

Create a full, consistent volume backup during a short maintenance stop:

```bash
BACKUP_ROOT=/root/infinite-canvas-backups \
DATA_VOLUME_NAME=infinite-canvas-data \
sh ops/backup-volume.sh
```

Keep at least one copy on another machine or object-storage provider. Store the production environment file and `APP_ENCRYPTION_KEY` separately in an encrypted secret backup; do not place them beside the data archive. Test a restore monthly with the exact tested image tag or digest:

```bash
ARCHIVE=/root/infinite-canvas-backups/infinite-canvas-YYYYMMDDTHHMMSSZ.tar.gz \
CONFIRM_RESTORE=infinite-canvas-data \
DATA_VOLUME_NAME=infinite-canvas-data \
IMAGE_REF="$IMAGE_REF" \
sh ops/restore-volume.sh
```

The restore script validates the checksum and archive before stopping the app. It then creates a `pre-restore-*.tar.gz` safety archive before replacing the volume. If restore fails, the app deliberately remains stopped; diagnose the failure or restore that safety archive before starting the container.

Backups created before checksum sidecars were introduced are rejected by default. Only for a trusted legacy archive, set `ALLOW_UNVERIFIED_RESTORE=1` explicitly; create a new verified backup immediately after recovery.

## Operations Checklist

- Keep public registration limited to invited users.
- Confirm `ALLOW_NEW_USERS=0` after onboarding.
- Initialize the administrator over loopback before opening `80/443`.
- Monitor `/health`; HTTP 503 means SQLite is unavailable, disk is below the configured floor, or shutdown is in progress.
- Alert at 20% disk free and keep `MIN_FREE_DISK_BYTES` at 512 MB or higher.
- Keep Docker log rotation enabled.
- Keep Watchtower disabled for the application container and deploy only a tested tag or digest.
- Review failed/refunded generation usage and channel latency weekly.
- Run one restore drill before opening the site publicly.
