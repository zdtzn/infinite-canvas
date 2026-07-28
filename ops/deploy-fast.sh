#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"

DEPLOY_MODE=fast
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-30}"

export DEPLOY_MODE HEALTH_TIMEOUT_SECONDS
exec "$SCRIPT_DIR/deploy-latest.sh"
