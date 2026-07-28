#!/bin/sh
set -eu

VOLUME_NAME="${VOLUME_NAME:-${DATA_VOLUME_NAME:-infinite-canvas-data}}"
CONTAINER_NAME="${CONTAINER_NAME:-infinite-canvas}"
IMAGE_REF="${IMAGE_REF:-}"
ARCHIVE="${ARCHIVE:-}"

if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "Set ARCHIVE to an existing full-volume .tar.gz backup" >&2
  exit 1
fi
if [ -z "$IMAGE_REF" ]; then
  echo "Set IMAGE_REF to the tested application tag or immutable digest used for this restore" >&2
  exit 1
fi
if [ "${CONFIRM_RESTORE:-}" != "$VOLUME_NAME" ]; then
  echo "Restore replaces all data in Docker volume '$VOLUME_NAME'." >&2
  echo "Run again with CONFIRM_RESTORE=$VOLUME_NAME" >&2
  exit 1
fi

backup_dir="$(cd "$(dirname "$ARCHIVE")" && pwd)"
archive_name="$(basename "$ARCHIVE")"
was_running=0
restore_succeeded=0

if [ ! -f "${ARCHIVE}.sha256" ]; then
  if [ "${ALLOW_UNVERIFIED_RESTORE:-}" != "1" ]; then
    echo "Missing checksum file: ${ARCHIVE}.sha256" >&2
    echo "Use a verified backup, or explicitly set ALLOW_UNVERIFIED_RESTORE=1 for a trusted legacy archive." >&2
    exit 1
  fi
  echo "WARNING: restoring a legacy archive without a checksum" >&2
else
  (cd "$backup_dir" && sha256sum -c "${archive_name}.sha256")
fi
if ! docker run --rm -v "${backup_dir}:/backup:ro" alpine sh -c '
  tar -tzf "$1" | awk "
    /(^|\/)\.\.(\/|$)|^\// { unsafe = 1 }
    \$0 == \"app.sqlite\" || \$0 == \"./app.sqlite\" { database = 1 }
    END { exit (unsafe || !database) }
  "
' sh "/backup/${archive_name}"; then
  echo "Backup archive is unsafe or does not contain app.sqlite" >&2
  exit 1
fi

if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1 && [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME")" = "true" ]; then
  was_running=1
  docker stop -t 30 "$CONTAINER_NAME" >/dev/null
fi

on_exit() {
  status=$?
  if [ "$was_running" = "1" ]; then
    if [ "$restore_succeeded" = "1" ]; then
      docker start "$CONTAINER_NAME" >/dev/null
    else
      echo "Restore failed. '$CONTAINER_NAME' remains stopped to protect the existing data." >&2
    fi
  fi
  trap - EXIT
  exit "$status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

volume_existed=0
if docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
  volume_existed=1
else
  docker volume create "$VOLUME_NAME" >/dev/null
fi

if [ "$volume_existed" = "1" ]; then
  safety_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  safety_archive="pre-restore-${safety_timestamp}.tar.gz"
  docker run --rm \
    -v "${VOLUME_NAME}:/source:ro" \
    -v "${backup_dir}:/backup" \
    alpine sh -c "cd /source && tar -czf '/backup/${safety_archive}' ."
  (cd "$backup_dir" && sha256sum "$safety_archive" > "${safety_archive}.sha256")
  echo "Pre-restore safety backup: ${backup_dir}/${safety_archive}"
fi

docker run --rm -v "${VOLUME_NAME}:/target" alpine sh -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
docker run --rm \
  -v "${VOLUME_NAME}:/target" \
  -v "${backup_dir}:/backup:ro" \
  alpine tar -xzf "/backup/${archive_name}" -C /target
docker run --rm --user root --entrypoint sh \
  -v "${VOLUME_NAME}:/data" \
  "$IMAGE_REF" \
  -c 'chown -R bun:bun /data'

restore_succeeded=1
if [ "$was_running" = "1" ]; then
  docker start "$CONTAINER_NAME" >/dev/null
  was_running=0
fi

echo "Restore completed from: $ARCHIVE"
