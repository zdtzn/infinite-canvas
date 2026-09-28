#!/bin/sh
set -eu

IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-ghcr.io/zdtzn/infinite-canvas}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
EXPECTED_COMMIT="${EXPECTED_COMMIT:-}"
IMAGE_WAIT_SECONDS="${IMAGE_WAIT_SECONDS:-600}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-5}"
SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/deploy-runtime.sh"

if ! printf '%s' "$EXPECTED_COMMIT" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "EXPECTED_COMMIT must be a full lowercase Git commit SHA" >&2
  exit 1
fi
case "$IMAGE_TAG" in
  ''|*[!A-Za-z0-9_.-]*) echo "IMAGE_TAG contains unsupported characters" >&2; exit 1 ;;
esac
case "$IMAGE_WAIT_SECONDS:$POLL_INTERVAL_SECONDS" in
  *[!0-9:]*|:*|*:) echo "Image wait values must be positive integers" >&2; exit 1 ;;
esac
if [ "$IMAGE_WAIT_SECONDS" -lt 1 ] || [ "$POLL_INTERVAL_SECONDS" -lt 1 ]; then
  echo "Image wait values must be positive integers" >&2
  exit 1
fi

IMAGE_CANDIDATE="${IMAGE_REPOSITORY}:${IMAGE_TAG}"
pull_image_with_deadline "$IMAGE_CANDIDATE"
image_revision="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE_CANDIDATE")"
if [ "$image_revision" != "$EXPECTED_COMMIT" ]; then
  echo "Downloaded image revision '$image_revision' does not match '$EXPECTED_COMMIT'; container unchanged" >&2
  exit 1
fi

IMAGE_REF="$(
  docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$IMAGE_CANDIDATE" |
    awk -v prefix="${IMAGE_REPOSITORY}@sha256:" 'index($0, prefix) == 1 { print; exit }'
)"
case "$IMAGE_REF" in
  *@sha256:*) ;;
  *) echo "Unable to resolve the verified image to an immutable digest" >&2; exit 1 ;;
esac

export IMAGE_REF EXPECTED_COMMIT
exec "$SCRIPT_DIR/deploy-pinned.sh"
