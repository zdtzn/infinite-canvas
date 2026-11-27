#!/bin/sh

# Bound registry waiting by elapsed time, including the download itself.
pull_image_with_deadline() {
  pull_target="$1"
  pull_budget="${IMAGE_WAIT_SECONDS:-600}"
  pull_interval="${POLL_INTERVAL_SECONDS:-5}"
  for pull_value in "$pull_budget" "$pull_interval"; do
    case "$pull_value" in
      ''|*[!0-9]*) echo "Image wait values must be positive integers" >&2; return 1 ;;
    esac
    if [ "$pull_value" -lt 1 ]; then
      echo "Image wait values must be positive integers" >&2
      return 1
    fi
  done
  command -v timeout >/dev/null || return 1
  pull_deadline=$(($(date +%s) + pull_budget))
  while :; do
    pull_remaining=$((pull_deadline - $(date +%s)))
    if [ "$pull_remaining" -le 0 ]; then
      echo "Image pull exceeded ${pull_budget}s: $pull_target. Running container unchanged." >&2
      return 1
    fi
    echo "Pulling $pull_target (${pull_remaining}s remaining)"
    if timeout --kill-after=5s "${pull_remaining}s" docker pull "$pull_target"; then
      return 0
    fi
    pull_remaining=$((pull_deadline - $(date +%s)))
    if [ "$pull_remaining" -gt 0 ]; then
      pull_pause="$pull_interval"
      if [ "$pull_pause" -gt "$pull_remaining" ]; then pull_pause="$pull_remaining"; fi
      echo "Image unavailable; retrying in ${pull_pause}s" >&2
      sleep "$pull_pause"
    fi
  done
}

# Only evict published image references older than a successfully started release.
cleanup_old_deployment_images() (
  deployed_ref="$1"
  deployed_id="$2"
  rollback_id="$3"
  repository="${deployed_ref%@*}"

  is_image_digest() {
    printf '%s\n' "$1" | grep -Eq '^sha256:[0-9a-f]{64}$'
  }

  case "$deployed_ref" in
    ''|-*|*' '*|*@*@*) return 1 ;;
  esac
  if ! is_image_digest "${deployed_ref##*@}" || [ "$repository" = "$deployed_ref" ]; then
    return 1
  fi
  if ! is_image_digest "$deployed_id" || ! is_image_digest "$rollback_id" || [ "$deployed_id" = "$rollback_id" ]; then
    echo "Image cleanup skipped because no distinct rollback image was identified."
    return 0
  fi

  cleanup_deadline=$(($(date +%s) + 45))
  cleanup_docker() {
    cleanup_remaining=$((cleanup_deadline - $(date +%s)))
    if [ "$cleanup_remaining" -le 0 ]; then return 1; fi
    if [ "$cleanup_remaining" -gt 6 ]; then cleanup_remaining=6; fi
    timeout --kill-after=1s "${cleanup_remaining}s" docker "$@"
  }

  # Leave the cache alone if the prior working image cannot be confirmed locally.
  if [ "$(cleanup_docker image inspect -f '{{.Id}}' "$rollback_id" 2>/dev/null)" != "$rollback_id" ]; then
    echo "Image cleanup skipped because the rollback image is unavailable locally."
    return 0
  fi

  image_rows=$(cleanup_docker image ls --filter "before=$deployed_id" --digests --no-trunc \
    --format '{{.Repository}} {{.Tag}} {{.ID}} {{.Digest}}' "$repository") || return 1
  removed=0
  kept=0
  while IFS=' ' read -r image_repository tag id digest; do
    if [ "$(date +%s)" -ge "$cleanup_deadline" ]; then
      echo "Image cleanup reached its time limit. Remaining images were kept."
      break
    fi
    [ "$image_repository" = "$repository" ] || continue
    [ "$id" != "$deployed_id" ] && [ "$id" != "$rollback_id" ] || continue
    is_image_digest "$id" && is_image_digest "$digest" || continue

    digest_ref="$repository@$digest"
    if [ "$tag" = "<none>" ]; then
      local_ref="$digest_ref"
    elif printf '%s\n' "$tag" | grep -Eq '^[0-9a-f]{40}$'; then
      local_ref="$repository:$tag"
    else
      continue
    fi

    if ! cleanup_docker buildx imagetools inspect --raw "$digest_ref" >/dev/null 2>&1; then
      kept=$((kept + 1))
      continue
    fi
    local_info=$(cleanup_docker image inspect -f '{{.Id}} {{len .RepoTags}}' "$local_ref" 2>/dev/null) || continue
    [ "${local_info% *}" = "$id" ] || continue
    [ "$tag" != "<none>" ] || [ "${local_info##* }" = "0" ] || continue
    users=$(cleanup_docker ps -aq --filter "ancestor=$id" 2>/dev/null) || continue
    [ -z "$users" ] || continue
    if cleanup_docker image rm --no-prune "$local_ref" >/dev/null; then removed=$((removed + 1)); fi
  done <<EOF
$image_rows
EOF
  echo "Image cleanup removed $removed cached image references and kept $kept without registry confirmation."
)
