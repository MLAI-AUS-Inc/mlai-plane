#!/usr/bin/env bash
set -euo pipefail
# This stack is separate from /opt/mlai-plane and cannot start its migrator.
cd /opt/mlai-plane-sync
image=$(sed -n 's/^PLANE_SYNC_IMAGE=//p' /etc/mlai-plane-sync/image.env)
[[ "$image" =~ ^(ghcr\.io/mlai-aus-inc/mlai-plane-linear-sync@)?sha256:[0-9a-f]{64}$ ]] || {
  echo 'Require an immutable MLAI sync registry digest or local image ID' >&2
  exit 1
}
export PLANE_SYNC_IMAGE="$image"
exec docker compose -f compose.yml run --rm --no-deps --pull never sync
