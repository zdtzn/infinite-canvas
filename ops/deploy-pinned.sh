#!/bin/sh
set -eu

CONTAINER_NAME="${CONTAINER_NAME:-infinite-canvas}"
VOLUME_NAME="${VOLUME_NAME:-${DATA_VOLUME_NAME:-infinite-canvas-data}}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/infinite-canvas-backups}"
BACKUP_BASE_SNAPSHOT="${BACKUP_BASE_SNAPSHOT:-}"
ENV_FILE="${ENV_FILE:-/root/infinite-canvas.env}"
BIND_ADDRESS="${BIND_ADDRESS:-}"
HOST_PORT="${HOST_PORT:-3000}"
CONTAINER_PORT="${CONTAINER_PORT:-3000}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-90}"
BACKUP_MIN_FREE_MB="${BACKUP_MIN_FREE_MB:-4096}"
PIDS_LIMIT="${PIDS_LIMIT:-256}"
LOG_MAX_SIZE="${LOG_MAX_SIZE:-10m}"
LOG_MAX_FILE="${LOG_MAX_FILE:-5}"
MEMORY_LIMIT="${MEMORY_LIMIT:-}"
MEMORY_SWAP_LIMIT="${MEMORY_SWAP_LIMIT:-}"
REQUIRE_HTTPS="${REQUIRE_HTTPS:-0}"
FORCE_RECREATE="${FORCE_RECREATE:-0}"
ALLOW_ACTIVE_JOBS="${ALLOW_ACTIVE_JOBS:-0}"
DEPLOY_MODE="${DEPLOY_MODE:-safe}"
IMAGE_REF="${IMAGE_REF:-}"
EXPECTED_COMMIT="${EXPECTED_COMMIT:-}"
EXPECTED_LIVE_COMMIT="${EXPECTED_LIVE_COMMIT:-}"
DEPLOY_LOCK_FILE="${DEPLOY_LOCK_FILE:-/var/lock/infinite-canvas-deploy.lock}"
SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/deploy-runtime.sh"

assert_live_revision() {
  if [ -n "$EXPECTED_LIVE_COMMIT" ]; then
    live_revision="$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$CONTAINER_NAME")"
    if [ "$live_revision" != "$EXPECTED_LIVE_COMMIT" ]; then
      echo "Live revision changed; rerun deployment from the latest state" >&2
      exit 1
    fi
  fi
}

case "$IMAGE_REF" in
  *@sha256:*) ;;
  *) echo "IMAGE_REF must be an immutable repository digest" >&2; exit 1 ;;
esac
case "$BACKUP_ROOT" in
  /*) ;;
  *) echo "BACKUP_ROOT must be an absolute host path" >&2; exit 1 ;;
esac
case "$ENV_FILE" in
  /*) ;;
  *) echo "ENV_FILE must be an absolute host path" >&2; exit 1 ;;
esac
for numeric_value in "$HEALTH_TIMEOUT_SECONDS" "$BACKUP_MIN_FREE_MB" "$PIDS_LIMIT" "$LOG_MAX_FILE"; do
  case "$numeric_value" in
    ''|*[!0-9]*) echo "Timeout, free-space, PID and log limits must be positive integers" >&2; exit 1 ;;
  esac
done
if [ "$HEALTH_TIMEOUT_SECONDS" -lt 1 ] || [ "$BACKUP_MIN_FREE_MB" -lt 512 ] || [ "$PIDS_LIMIT" -lt 32 ] || [ "$LOG_MAX_FILE" -lt 1 ]; then
  echo "Timeout, free-space, PID and log limits are outside the allowed range" >&2
  exit 1
fi
case "$FORCE_RECREATE" in
  0|1) ;;
  *) echo "FORCE_RECREATE must be 0 or 1" >&2; exit 1 ;;
esac
case "$ALLOW_ACTIVE_JOBS" in
  0|1) ;;
  *) echo "ALLOW_ACTIVE_JOBS must be 0 or 1" >&2; exit 1 ;;
esac
case "$DEPLOY_MODE" in
  safe|fast) ;;
  *) echo "DEPLOY_MODE must be safe or fast" >&2; exit 1 ;;
esac
case "$REQUIRE_HTTPS" in
  0|1) ;;
  *) echo "REQUIRE_HTTPS must be 0 or 1" >&2; exit 1 ;;
esac
if [ -n "$EXPECTED_COMMIT" ] && ! printf '%s' "$EXPECTED_COMMIT" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "EXPECTED_COMMIT must be a full lowercase Git commit SHA" >&2
  exit 1
fi
if [ -n "$EXPECTED_LIVE_COMMIT" ] && ! printf '%s' "$EXPECTED_LIVE_COMMIT" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "EXPECTED_LIVE_COMMIT must be a full lowercase Git commit SHA" >&2
  exit 1
fi
case "$DEPLOY_LOCK_FILE" in
  /*) ;;
  *) echo "DEPLOY_LOCK_FILE must be an absolute host path" >&2; exit 1 ;;
esac
command -v flock >/dev/null
command -v timeout >/dev/null
exec 9>"$DEPLOY_LOCK_FILE"
if ! flock -n 9; then
  echo "Another deployment is running; container unchanged. Retry after it completes." >&2
  exit 75
fi

# Keep the lock through preflight, switching, rollback, and image cleanup.
current_ref="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER_NAME")"
current_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER_NAME")"
current_revision="$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$CONTAINER_NAME")"
if [ "$FORCE_RECREATE" != "1" ] && [ "$current_ref" = "$IMAGE_REF" ] && [ "$current_health" = "healthy" ] &&
   { [ -z "$EXPECTED_COMMIT" ] || [ "$current_revision" = "$EXPECTED_COMMIT" ]; }; then
  echo "Already running healthy image: $IMAGE_REF"
  exit 0
fi
rollback_image_id="$(timeout --kill-after=1s 6s docker inspect -f '{{.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
assert_live_revision

docker volume inspect "$VOLUME_NAME" >/dev/null
docker inspect "$CONTAINER_NAME" >/dev/null
docker run --rm -v "${VOLUME_NAME}:/source:ro" alpine test -f /source/app.sqlite

if [ -z "$BIND_ADDRESS" ]; then
  BIND_ADDRESS="$(docker inspect -f "{{with index .HostConfig.PortBindings \"${CONTAINER_PORT}/tcp\"}}{{with index . 0}}{{.HostIp}}{{end}}{{end}}" "$CONTAINER_NAME" 2>/dev/null || true)"
  BIND_ADDRESS="${BIND_ADDRESS:-127.0.0.1}"
fi
if ! printf '%s' "$BIND_ADDRESS" | grep -Eq '^[0-9A-Fa-f:.]+$'; then
  echo "BIND_ADDRESS must be a literal IP address" >&2
  exit 1
fi
PUBLISH_ADDRESS="$BIND_ADDRESS"
case "$PUBLISH_ADDRESS" in
  *:*) PUBLISH_ADDRESS="[${PUBLISH_ADDRESS}]" ;;
esac
if [ -n "$MEMORY_SWAP_LIMIT" ] && [ -z "$MEMORY_LIMIT" ]; then
  echo "MEMORY_SWAP_LIMIT requires MEMORY_LIMIT" >&2
  exit 1
fi

assert_no_active_jobs() {
  if [ "$ALLOW_ACTIVE_JOBS" = "1" ]; then
    return 0
  fi

  container_running="$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  if [ "$container_running" != "true" ]; then
    return 0
  fi

  if ! active_jobs="$(docker exec "$CONTAINER_NAME" bun -e 'import { Database } from "bun:sqlite"; const db = new Database("/data/app.sqlite", { readonly: true }); const rows = db.query("SELECT payload_json FROM jobs").all(); console.log(rows.filter((row) => { try { return ["queued", "running"].includes(JSON.parse(row.payload_json).status); } catch { return false; } }).length);' | tr -d '\r\n')"; then
    echo "Unable to determine active generation job count" >&2
    exit 1
  fi
  case "$active_jobs" in
    ''|*[!0-9]*) echo "Unable to determine active generation job count" >&2; exit 1 ;;
  esac
  if [ "$active_jobs" -gt 0 ]; then
    echo "Deployment blocked: ${active_jobs} generation job(s) are queued or running. Wait for them to finish, or set ALLOW_ACTIVE_JOBS=1 only for an intentional interruption." >&2
    exit 1
  fi
}

assert_no_active_jobs
if ! docker image inspect "$IMAGE_REF" >/dev/null 2>&1; then
  pull_image_with_deadline "$IMAGE_REF"
fi

if [ -f "$ENV_FILE" ]; then
  docker run --rm \
    --env-file "$ENV_FILE" \
    -e "DEPLOY_REQUIRE_HTTPS=${REQUIRE_HTTPS}" \
    "$IMAGE_REF" \
    bun -e '
      const required = process.env.DEPLOY_REQUIRE_HTTPS === "1";
      const rawBase = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
      const secureCookies = process.env.FORCE_SECURE_COOKIES === "1";
      const trustProxy = process.env.TRUST_PROXY === "1";
      const productionConfigured = required || Boolean(rawBase) || secureCookies || trustProxy;
      if (!productionConfigured) process.exit(0);
      let base;
      try { base = new URL(rawBase); } catch { throw new Error("PUBLIC_BASE_URL must be a valid HTTPS origin"); }
      if (base.protocol !== "https:" || base.origin !== rawBase) throw new Error("PUBLIC_BASE_URL must be the canonical HTTPS origin without a path");
      if (!secureCookies) throw new Error("FORCE_SECURE_COOKIES must be 1 for HTTPS deployment");
      if (!trustProxy) throw new Error("TRUST_PROXY must be 1 behind Caddy");
      const key = String(process.env.APP_ENCRYPTION_KEY || "").trim();
      if (key.length < 32 || /^(?:replace-with|change-me|example|password|secret)/i.test(key)) throw new Error("APP_ENCRYPTION_KEY must be a stable random secret of at least 32 characters");
    '
elif [ "$REQUIRE_HTTPS" = "1" ]; then
  echo "ENV_FILE is required when REQUIRE_HTTPS=1" >&2
  exit 1
fi

case "$BIND_ADDRESS" in
  127.0.0.1|::1) ;;
  *)
    if [ "$REQUIRE_HTTPS" = "1" ]; then
      echo "REQUIRE_HTTPS=1 requires BIND_ADDRESS=127.0.0.1 or ::1; refusing to expose application port ${HOST_PORT}." >&2
      exit 1
    fi
    echo "WARNING: application port ${HOST_PORT} remains bound to ${BIND_ADDRESS}. Keep the cloud firewall closed except for intentional direct-IP testing." >&2
    ;;
esac

image_revision="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE_REF")"
if [ -n "$EXPECTED_COMMIT" ] && [ "$image_revision" != "$EXPECTED_COMMIT" ]; then
  echo "Image revision '$image_revision' does not match EXPECTED_COMMIT '$EXPECTED_COMMIT'" >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_stage=""
backup_record="not-created-fast-deploy"
rollback_name="${CONTAINER_NAME}-rollback-${timestamp}"
health_file="/tmp/${CONTAINER_NAME}-deploy-health-$$.json"
switch_started=0
renamed=0
deployment_complete=0
readiness_state="healthy"
if [ "$DEPLOY_MODE" = "fast" ]; then
  readiness_state="ready"
fi

wait_for_healthy() {
  expected_revision="$1"
  health_deadline=$(($(date +%s) + HEALTH_TIMEOUT_SECONDS))

  while [ "$(date +%s)" -lt "$health_deadline" ]; do
    health_remaining=$((health_deadline - $(date +%s)))
    if [ "$health_remaining" -le 0 ]; then break; fi
    container_health="$(timeout --kill-after=1s "${health_remaining}s" docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER_NAME" 2>/dev/null || true)"
    health_remaining=$((health_deadline - $(date +%s)))
    if [ "$health_remaining" -le 0 ]; then break; fi
    container_running="$(timeout --kill-after=1s "${health_remaining}s" docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || true)"
    health_gate=0
    if [ "$DEPLOY_MODE" = "fast" ] && [ "$container_running" = "true" ]; then
      health_gate=1
    elif [ "$DEPLOY_MODE" = "safe" ] && [ "$container_health" = "healthy" ]; then
      health_gate=1
    fi
    health_remaining=$((health_deadline - $(date +%s)))
    if [ "$health_remaining" -le 0 ]; then break; fi
    health_request_timeout=5
    if [ "$health_remaining" -lt 5 ]; then health_request_timeout="$health_remaining"; fi
    if [ "$health_gate" = "1" ] && curl -fsS --connect-timeout 2 --max-time "$health_request_timeout" "http://127.0.0.1:${HOST_PORT}/health" >"$health_file" 2>/dev/null; then
      if [ -z "$expected_revision" ] || grep -q "$expected_revision" "$health_file"; then
        return 0
      fi
    fi
    health_remaining=$((health_deadline - $(date +%s)))
    if [ "$health_remaining" -gt 0 ]; then
      health_pause=2
      if [ "$health_remaining" -lt 2 ]; then health_pause="$health_remaining"; fi
      sleep "$health_pause"
    fi
  done

  return 1
}

recover_on_failure() {
  status=$?
  trap - EXIT INT TERM
  rm -f "$health_file"
  if [ -n "$backup_stage" ]; then
    rm -rf -- "$backup_stage" || echo "Could not remove incomplete backup at $backup_stage" >&2
  fi
  if [ "$switch_started" = "1" ] && [ "$deployment_complete" != "1" ]; then
    echo "Deployment failed; restoring the previous container" >&2
    restore_started=0
    if [ "$renamed" = "1" ]; then
      docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
      if docker inspect "$rollback_name" >/dev/null 2>&1; then
        if docker rename "$rollback_name" "$CONTAINER_NAME" >/dev/null &&
          docker update --restart=unless-stopped "$CONTAINER_NAME" >/dev/null &&
          docker start "$CONTAINER_NAME" >/dev/null; then
          restore_started=1
        fi
      fi
    elif docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
      if docker start "$CONTAINER_NAME" >/dev/null 2>&1; then
        restore_started=1
      fi
    fi

    if [ "$restore_started" = "1" ] && docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
      echo "Waiting for the previous container to become ${readiness_state}" >&2
      if wait_for_healthy ""; then
        echo "Previous container restored and ${readiness_state}" >&2
      else
        echo "Previous container was restored but did not become ${readiness_state} within ${HEALTH_TIMEOUT_SECONDS}s" >&2
        docker logs --tail=120 "$CONTAINER_NAME" >&2 || true
      fi
    else
      echo "Previous container could not be restored" >&2
    fi
  fi
  exit "$status"
}
assert_backup_space() {
  copy_kb="$1"
  free_kb="$(df -Pk "$BACKUP_ROOT" | awk 'NR == 2 { print $4 }')"
  required_kb=$((copy_kb + BACKUP_MIN_FREE_MB * 1024))
  if [ "${free_kb:-0}" -lt "$required_kb" ]; then
    echo "Not enough free space for a safe backup: ${free_kb:-0} KiB available, ${required_kb} KiB required. Free space or use a larger backup filesystem." >&2
    exit 1
  fi
}

estimate_snapshot_copy_kb() {
  snapshot_stats="$(LC_ALL=C nice -n 10 rsync -aHSn --numeric-ids --stats --link-dest="$1" "$volume_path/" "$2/")" || return 1
  printf '%s\n' "$snapshot_stats" | awk '
    /^Total transferred file size:/ {
      bytes = $5
      gsub(/,/, "", bytes)
      if (bytes !~ /^[0-9]+$/) exit 1
      printf "%.0f\n", int((bytes + 1023) / 1024)
      found = 1
    }
    END { if (!found) exit 1 }
  '
}

trap recover_on_failure EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

umask 077
if [ "$DEPLOY_MODE" = "safe" ]; then
  command -v rsync >/dev/null || { echo "Safe deployment requires rsync on the Docker host" >&2; exit 1; }
  live_volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}:{{.Name}}{{end}}{{end}}' "$CONTAINER_NAME")"
  if [ "$live_volume" != "volume:$VOLUME_NAME" ]; then
    echo "The running container does not use $VOLUME_NAME at /data" >&2
    exit 1
  fi
  volume_path="$(docker volume inspect -f '{{.Mountpoint}}' "$VOLUME_NAME")"
  case "$volume_path" in
    /?*) volume_path="$(cd "$volume_path" && pwd -P)" ;;
    *) echo "Unable to locate the Docker data volume on the deployment host" >&2; exit 1 ;;
  esac
  BACKUP_ROOT="$(realpath -m -- "$BACKUP_ROOT")"
  case "$BACKUP_ROOT/" in
    "$volume_path/"*) echo "BACKUP_ROOT must be outside the live data volume" >&2; exit 1 ;;
  esac
  mkdir -p "$BACKUP_ROOT"
  backup_record="$BACKUP_ROOT/infinite-canvas-${timestamp}.snapshot"
  if [ -e "$backup_record" ] || [ -L "$backup_record" ]; then
    echo "Backup already exists at $backup_record" >&2
    exit 1
  fi
  backup_stage="$(mktemp -d "$BACKUP_ROOT/.infinite-canvas-${timestamp}.XXXXXX")"
  mkdir "$backup_stage/data"
  echo "Copying the data volume while the current application is running"
  # The stopped pass will capture SQLite and any files written or removed during this copy.
  set --
  if [ -n "$BACKUP_BASE_SNAPSHOT" ]; then
    base_snapshot="$(realpath -e -- "$BACKUP_BASE_SNAPSHOT")"
    case "$base_snapshot" in
      "$BACKUP_ROOT"/infinite-canvas-*.snapshot) ;;
      *) echo "Backup base must be an existing deployment snapshot in BACKUP_ROOT" >&2; exit 1 ;;
    esac
    if [ "$(dirname -- "$base_snapshot")" != "$BACKUP_ROOT" ] ||
       [ -L "$base_snapshot/data" ] || [ ! -s "$base_snapshot/data/app.sqlite" ] ||
       [ ! -s "$base_snapshot/SHA256SUMS" ] ||
       [ "$(stat -c %d -- "$base_snapshot/data")" != "$(stat -c %d -- "$backup_stage")" ]; then
      echo "Backup base must contain a complete snapshot on the backup filesystem" >&2
      exit 1
    fi
    echo "Verifying the backup base before reusing unchanged files"
    (cd "$base_snapshot/data" && nice -n 10 sha256sum -c --quiet --strict ../SHA256SUMS)
    copy_kb="$(estimate_snapshot_copy_kb "$base_snapshot/data" "$backup_stage/data")" ||
      { echo "Unable to estimate the space needed with the backup base" >&2; exit 1; }
    set -- --link-dest="$base_snapshot/data"
  else
    copy_kb="$(du -sk "$volume_path" | awk '{ print $1 }')"
    case "$copy_kb" in
      ''|*[!0-9]*) echo "Unable to estimate the full data volume size" >&2; exit 1 ;;
    esac
  fi
  assert_backup_space "$copy_kb"
  nice -n 10 rsync -aHS --numeric-ids --exclude='/app.sqlite' --exclude='/app.sqlite-wal' --exclude='/app.sqlite-shm' \
    "$@" "$volume_path/" "$backup_stage/data/" || [ "$?" -eq 24 ]
  if [ -n "$BACKUP_BASE_SNAPSHOT" ]; then
    mkdir "$backup_stage/final"
    # The online copy excludes SQLite, so this estimate includes its stopped copy.
    copy_kb="$(estimate_snapshot_copy_kb "$backup_stage/data" "$backup_stage/final")" ||
      { echo "Unable to estimate the space needed to finalize the backup" >&2; exit 1; }
  else
    copy_kb=0
  fi
  assert_backup_space "$copy_kb"
else
  mkdir -p "$BACKUP_ROOT"
fi

assert_no_active_jobs
assert_live_revision
switch_started=1
docker stop -t 30 "$CONTAINER_NAME" >/dev/null
if [ "$DEPLOY_MODE" = "safe" ]; then
  echo "Finalizing the backup from the stopped data volume"
  if [ -n "$BACKUP_BASE_SNAPSHOT" ]; then
    # An empty receiver keeps rsync from updating shared inode metadata in place.
    rsync -aHS --numeric-ids --checksum --link-dest="$backup_stage/data" "$volume_path/" "$backup_stage/final/"
    rm -rf -- "$backup_stage/data"
    mv -- "$backup_stage/final" "$backup_stage/data"
  else
    rsync -aHS --numeric-ids --delete --checksum "$volume_path/" "$backup_stage/data/"
  fi
  assert_backup_space 0
  docker run --rm --network none -v "$backup_stage/data:/snapshot:ro" "$IMAGE_REF" bun -e '
    import { Database } from "bun:sqlite";
    const db = new Database("/snapshot/app.sqlite", { readonly: true });
    try {
      const rows = db.query("PRAGMA quick_check").all();
      if (rows.length !== 1 || rows[0].quick_check !== "ok") throw new Error("Backup SQLite integrity check failed");
    } finally {
      db.close();
    }
  '
  (cd "$backup_stage/data" && find . -type f -exec sha256sum -- {} + > "$backup_stage/SHA256SUMS")
  mv -T --no-clobber -- "$backup_stage" "$backup_record"
  [ ! -e "$backup_stage" ] || { echo "Backup already exists at $backup_record" >&2; exit 1; }
  backup_stage=""
  echo "Verified full-volume backup: $backup_record"
else
  echo "Fast deployment: full-volume backup skipped"
fi

docker rename "$CONTAINER_NAME" "$rollback_name"
renamed=1
docker update --restart=no "$rollback_name" >/dev/null

set -- docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --stop-timeout 30 \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  --pids-limit "$PIDS_LIMIT" \
  --log-driver json-file \
  --log-opt "max-size=${LOG_MAX_SIZE}" \
  --log-opt "max-file=${LOG_MAX_FILE}" \
  -p "${PUBLISH_ADDRESS}:${HOST_PORT}:${CONTAINER_PORT}" \
  -v "${VOLUME_NAME}:/data" \
  --label com.centurylinklabs.watchtower.enable=false
if [ -n "$MEMORY_LIMIT" ]; then
  set -- "$@" --memory "$MEMORY_LIMIT"
fi
if [ -n "$MEMORY_SWAP_LIMIT" ]; then
  set -- "$@" --memory-swap "$MEMORY_SWAP_LIMIT"
fi
if [ -f "$ENV_FILE" ]; then
  set -- "$@" --env-file "$ENV_FILE"
fi
set -- "$@" "$IMAGE_REF"
"$@" >/dev/null

echo "Waiting for the new container to become ${readiness_state}"
if ! wait_for_healthy "$EXPECTED_COMMIT"; then
  docker logs --tail=120 "$CONTAINER_NAME" >&2 || true
  exit 1
fi

deployment_health="$(cat "$health_file")"
deployment_complete=1
trap - EXIT INT TERM
docker rm "$rollback_name" >/dev/null
rm -f "$health_file"

cat >"${BACKUP_ROOT}/last-deployment.txt" <<EOF
deployed_at=${timestamp}
deploy_mode=${DEPLOY_MODE}
image_ref=${IMAGE_REF}
image_revision=${image_revision}
backup=${backup_record}
EOF

echo "Deployment successful"
echo "Mode: $DEPLOY_MODE"
echo "Image: $IMAGE_REF"
echo "Revision: $image_revision"
echo "Backup: ${backup_record}"
# Reuse the successful readiness response; a second transient request must not
# turn a completed deployment into an apparent container-switch failure.
printf '%s\n' "$deployment_health"
printf '\n'

# A cleanup failure must not turn a healthy deployment into a rollback.
if [ "$current_health" = "healthy" ]; then
  deployed_image_id="$(timeout --kill-after=1s 6s docker inspect -f '{{.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  cleanup_old_deployment_images "$IMAGE_REF" "$deployed_image_id" "$rollback_image_id" ||
    echo "Image cleanup did not complete. Deployment remains healthy." >&2
else
  echo "Image cleanup skipped because the previous container was not confirmed healthy."
fi
