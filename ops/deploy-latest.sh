#!/bin/sh
set -eu

IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-ghcr.io/zdtzn/infinite-canvas}"
SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"

docker pull "${IMAGE_REPOSITORY}:latest" >/dev/null
IMAGE_REF="$(
  docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "${IMAGE_REPOSITORY}:latest" |
    awk -v prefix="${IMAGE_REPOSITORY}@sha256:" 'index($0, prefix) == 1 { print; exit }'
)"
EXPECTED_COMMIT="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${IMAGE_REPOSITORY}:latest")"

case "$IMAGE_REF" in
  *@sha256:*) ;;
  *) echo "Unable to resolve latest image to an immutable digest" >&2; exit 1 ;;
esac
if ! printf '%s' "$EXPECTED_COMMIT" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "Published image is missing a valid source revision label" >&2
  exit 1
fi

export IMAGE_REF EXPECTED_COMMIT
exec "$SCRIPT_DIR/deploy-pinned.sh"
