#!/bin/sh
set -eu

IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-ghcr.io/zdtzn/infinite-canvas}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
EXPECTED_COMMIT="${EXPECTED_COMMIT:-}"
IMAGE_WAIT_SECONDS="${IMAGE_WAIT_SECONDS:-600}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-5}"
SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"

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
attempts=$((IMAGE_WAIT_SECONDS / POLL_INTERVAL_SECONDS + 1))
attempt=1
image_revision=""
while [ "$attempt" -le "$attempts" ]; do
  if docker pull "$IMAGE_CANDIDATE" >/dev/null 2>&1; then
    image_revision="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE_CANDIDATE" 2>/dev/null || true)"
    if [ "$image_revision" = "$EXPECTED_COMMIT" ]; then
      break
    fi
  fi
  if [ "$attempt" -eq "$attempts" ]; then
    echo "Timed out waiting for ${IMAGE_CANDIDATE} to publish commit ${EXPECTED_COMMIT}; current revision is '${image_revision}'" >&2
    exit 1
  fi
  echo "Waiting for image ${IMAGE_CANDIDATE} (${attempt}/${attempts})"
  sleep "$POLL_INTERVAL_SECONDS"
  attempt=$((attempt + 1))
done

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
