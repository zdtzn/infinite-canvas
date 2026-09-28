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
