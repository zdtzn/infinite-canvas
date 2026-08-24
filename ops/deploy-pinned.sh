#!/bin/sh
set -eu

CONTAINER_NAME="${CONTAINER_NAME:-infinite-canvas}"
VOLUME_NAME="${VOLUME_NAME:-${DATA_VOLUME_NAME:-infinite-canvas-data}}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/infinite-canvas-backups}"
ENV_FILE="${ENV_FILE:-/root/infinite-canvas.env}"
BIND_ADDRESS="${BIND_ADDRESS:-}"
HOST_PORT="${HOST_PORT:-3000}"
CONTAINER_PORT="${CONTAINER_PORT:-3000}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-90}"
BACKUP_RETENTION_COUNT="${BACKUP_RETENTION_COUNT:-7}"
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

pull_image() {
  pull_attempt=1
  while [ "$pull_attempt" -le 3 ]; do
    if docker pull "$1" >/dev/null; then
      return 0
    fi
    if [ "$pull_attempt" -eq 3 ]; then
      echo "Unable to pull image after 3 attempts: $1" >&2
      return 1
    fi
    echo "Image pull failed; retrying in $((pull_attempt * 5))s" >&2
    sleep $((pull_attempt * 5))
    pull_attempt=$((pull_attempt + 1))
  done
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
for numeric_value in "$HEALTH_TIMEOUT_SECONDS" "$BACKUP_RETENTION_COUNT" "$PIDS_LIMIT" "$LOG_MAX_FILE"; do
  case "$numeric_value" in
    ''|*[!0-9]*) echo "Timeout, retention, PID and log limits must be positive integers" >&2; exit 1 ;;
  esac
done
if [ "$HEALTH_TIMEOUT_SECONDS" -lt 1 ] || [ "$BACKUP_RETENTION_COUNT" -lt 1 ] || [ "$PIDS_LIMIT" -lt 32 ] || [ "$LOG_MAX_FILE" -lt 1 ]; then
  echo "Timeout, retention, PID and log limits are outside the allowed range" >&2
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
  pull_image "$IMAGE_REF"
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

current_ref="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER_NAME")"
current_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER_NAME")"
if [ "$FORCE_RECREATE" != "1" ] && [ "$current_ref" = "$IMAGE_REF" ] && [ "$current_health" = "healthy" ]; then
  echo "Already running healthy image: $IMAGE_REF"
  exit 0
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive=""
backup_record="not-created-fast-deploy"
rollback_name="${CONTAINER_NAME}-rollback-${timestamp}"
health_file="/tmp/${CONTAINER_NAME}-deploy-health-$$.json"
renamed=0
deployment_complete=0
readiness_state="healthy"
if [ "$DEPLOY_MODE" = "fast" ]; then
  readiness_state="ready"
fi

wait_for_healthy() {
  expected_revision="$1"
  wait_attempt=0
  wait_max_attempts=$((HEALTH_TIMEOUT_SECONDS / 2 + 1))

  while [ "$wait_attempt" -lt "$wait_max_attempts" ]; do
    wait_attempt=$((wait_attempt + 1))
    container_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER_NAME" 2>/dev/null || true)"
    container_running="$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || true)"
    health_gate=0
    if [ "$DEPLOY_MODE" = "fast" ] && [ "$container_running" = "true" ]; then
      health_gate=1
    elif [ "$DEPLOY_MODE" = "safe" ] && [ "$container_health" = "healthy" ]; then
      health_gate=1
    fi
    if [ "$health_gate" = "1" ] && curl -fsS "http://127.0.0.1:${HOST_PORT}/health" >"$health_file" 2>/dev/null; then
      if [ -z "$expected_revision" ] || grep -q "$expected_revision" "$health_file"; then
        return 0
      fi
    fi
    sleep 2
  done

  return 1
}

recover_on_failure() {
  status=$?
  trap - EXIT INT TERM
  rm -f "$health_file"
  if [ "$deployment_complete" != "1" ]; then
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
trap recover_on_failure EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$BACKUP_ROOT"
assert_no_active_jobs
docker stop -t 30 "$CONTAINER_NAME" >/dev/null
if [ "$DEPLOY_MODE" = "safe" ]; then
  archive="infinite-canvas-${timestamp}.tar.gz"
  backup_record="${BACKUP_ROOT}/${archive}"
  docker run --rm \
    -v "${VOLUME_NAME}:/source:ro" \
    -v "${BACKUP_ROOT}:/backup" \
    alpine sh -c "cd /source && tar -czf '/backup/${archive}' ."
  (cd "$BACKUP_ROOT" && sha256sum "$archive" > "${archive}.sha256" && sha256sum -c "${archive}.sha256")
  docker run --rm -v "${BACKUP_ROOT}:/backup:ro" alpine sh -c "tar -tzf '/backup/${archive}' | grep -Eq '^(\./)?app\.sqlite$'"
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

deployment_complete=1
trap - EXIT INT TERM
docker rm "$rollback_name" >/dev/null
rm -f "$health_file"

if [ "$DEPLOY_MODE" = "safe" ]; then
  count=0
  for old_archive in $(ls -1t "$BACKUP_ROOT"/infinite-canvas-*.tar.gz 2>/dev/null || true); do
    count=$((count + 1))
    if [ "$count" -gt "$BACKUP_RETENTION_COUNT" ]; then
      rm -f "$old_archive" "${old_archive}.sha256"
    fi
  done
fi

umask 077
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
curl -fsS "http://127.0.0.1:${HOST_PORT}/health"
printf '\n'
