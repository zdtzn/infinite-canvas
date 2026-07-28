#!/bin/sh
set -eu

VOLUME_NAME="${VOLUME_NAME:-${DATA_VOLUME_NAME:-infinite-canvas-data}}"
CONTAINER_NAME="${CONTAINER_NAME:-infinite-canvas}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/infinite-canvas-backups}"

case "$BACKUP_ROOT" in
  /*) ;;
  *) echo "BACKUP_ROOT must be an absolute host path" >&2; exit 1 ;;
esac

if ! docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
  echo "Docker volume '$VOLUME_NAME' does not exist; refusing to create an empty backup" >&2
  exit 1
fi
if ! docker run --rm -v "${VOLUME_NAME}:/source:ro" alpine test -f /source/app.sqlite; then
  echo "Docker volume '$VOLUME_NAME' does not contain app.sqlite; refusing to create an incomplete backup" >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="infinite-canvas-${timestamp}.tar.gz"
was_running=0

if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1 && [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME")" = "true" ]; then
  was_running=1
  docker stop -t 30 "$CONTAINER_NAME" >/dev/null
fi

restart_container() {
  if [ "$was_running" = "1" ]; then
    docker start "$CONTAINER_NAME" >/dev/null
  fi
}
trap restart_container EXIT INT TERM

mkdir -p "$BACKUP_ROOT"
docker run --rm \
  -v "${VOLUME_NAME}:/source:ro" \
  -v "${BACKUP_ROOT}:/backup" \
  alpine sh -c "cd /source && tar -czf '/backup/${archive}' ."

(cd "$BACKUP_ROOT" && sha256sum "$archive" > "${archive}.sha256")

echo "Backup created: ${BACKUP_ROOT}/${archive}"
echo "This archive contains the full data volume. Keep APP_ENCRYPTION_KEY in a separate protected backup."
