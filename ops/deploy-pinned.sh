#!/bin/sh
set -eu

CONTAINER_NAME="${CONTAINER_NAME:-infinite-canvas}"
VOLUME_NAME="${VOLUME_NAME:-${DATA_VOLUME_NAME:-infinite-canvas-data}}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/infinite-canvas-backups}"
ENV_FILE="${ENV_FILE:-/root/infinite-canvas.env}"
BIND_ADDRESS="${BIND_ADDRESS:-0.0.0.0}"
HOST_PORT="${HOST_PORT:-3000}"
CONTAINER_PORT="${CONTAINER_PORT:-3000}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-90}"
BACKUP_RETENTION_COUNT="${BACKUP_RETENTION_COUNT:-7}"
FORCE_RECREATE="${FORCE_RECREATE:-0}"
IMAGE_REF="${IMAGE_REF:-}"
EXPECTED_COMMIT="${EXPECTED_COMMIT:-}"

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
case "$HEALTH_TIMEOUT_SECONDS:$BACKUP_RETENTION_COUNT" in
  *[!0-9:]*|:*|*:) echo "Timeout and retention values must be positive integers" >&2; exit 1 ;;
esac
if [ "$HEALTH_TIMEOUT_SECONDS" -lt 1 ] || [ "$BACKUP_RETENTION_COUNT" -lt 1 ]; then
  echo "Timeout and retention values must be positive integers" >&2
  exit 1
fi
case "$FORCE_RECREATE" in
  0|1) ;;
  *) echo "FORCE_RECREATE must be 0 or 1" >&2; exit 1 ;;
esac

docker volume inspect "$VOLUME_NAME" >/dev/null
docker inspect "$CONTAINER_NAME" >/dev/null
docker run --rm -v "${VOLUME_NAME}:/source:ro" alpine test -f /source/app.sqlite
docker pull "$IMAGE_REF" >/dev/null

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
archive="infinite-canvas-${timestamp}.tar.gz"
rollback_name="${CONTAINER_NAME}-rollback-${timestamp}"
health_file="/tmp/${CONTAINER_NAME}-deploy-health-$$.json"
renamed=0
deployment_complete=0

recover_on_failure() {
  status=$?
  rm -f "$health_file"
  if [ "$deployment_complete" != "1" ]; then
    echo "Deployment failed; restoring the previous container" >&2
    if [ "$renamed" = "1" ]; then
      docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
      if docker inspect "$rollback_name" >/dev/null 2>&1; then
        docker rename "$rollback_name" "$CONTAINER_NAME" >/dev/null
        docker update --restart=unless-stopped "$CONTAINER_NAME" >/dev/null
        docker start "$CONTAINER_NAME" >/dev/null
      fi
    elif docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
      docker start "$CONTAINER_NAME" >/dev/null 2>&1 || true
    fi
  fi
  exit "$status"
}
trap recover_on_failure EXIT INT TERM

mkdir -p "$BACKUP_ROOT"
docker stop -t 30 "$CONTAINER_NAME" >/dev/null
docker run --rm \
  -v "${VOLUME_NAME}:/source:ro" \
  -v "${BACKUP_ROOT}:/backup" \
  alpine sh -c "cd /source && tar -czf '/backup/${archive}' ."
(cd "$BACKUP_ROOT" && sha256sum "$archive" > "${archive}.sha256" && sha256sum -c "${archive}.sha256")
docker run --rm -v "${BACKUP_ROOT}:/backup:ro" alpine sh -c "tar -tzf '/backup/${archive}' | grep -Eq '^(\./)?app\.sqlite$'"

docker rename "$CONTAINER_NAME" "$rollback_name"
renamed=1
docker update --restart=no "$rollback_name" >/dev/null

set -- docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --stop-timeout 30 \
  -p "${BIND_ADDRESS}:${HOST_PORT}:${CONTAINER_PORT}" \
  -v "${VOLUME_NAME}:/data" \
  --label com.centurylinklabs.watchtower.enable=false
if [ -f "$ENV_FILE" ]; then
  set -- "$@" --env-file "$ENV_FILE"
fi
set -- "$@" "$IMAGE_REF"
"$@" >/dev/null

healthy=0
attempt=0
max_attempts=$((HEALTH_TIMEOUT_SECONDS / 2 + 1))
while [ "$attempt" -lt "$max_attempts" ]; do
  attempt=$((attempt + 1))
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/health" >"$health_file" 2>/dev/null; then
    if [ -z "$EXPECTED_COMMIT" ] || grep -q "$EXPECTED_COMMIT" "$health_file"; then
      healthy=1
      break
    fi
  fi
  sleep 2
done
if [ "$healthy" != "1" ]; then
  docker logs --tail=120 "$CONTAINER_NAME" >&2 || true
  exit 1
fi

deployment_complete=1
trap - EXIT INT TERM
docker rm "$rollback_name" >/dev/null
rm -f "$health_file"

count=0
for old_archive in $(ls -1t "$BACKUP_ROOT"/infinite-canvas-*.tar.gz 2>/dev/null || true); do
  count=$((count + 1))
  if [ "$count" -gt "$BACKUP_RETENTION_COUNT" ]; then
    rm -f "$old_archive" "${old_archive}.sha256"
  fi
done

umask 077
cat >"${BACKUP_ROOT}/last-deployment.txt" <<EOF
deployed_at=${timestamp}
image_ref=${IMAGE_REF}
image_revision=${image_revision}
backup=${BACKUP_ROOT}/${archive}
EOF

echo "Deployment successful"
echo "Image: $IMAGE_REF"
echo "Revision: $image_revision"
echo "Backup: ${BACKUP_ROOT}/${archive}"
curl -fsS "http://127.0.0.1:${HOST_PORT}/health"
printf '\n'
