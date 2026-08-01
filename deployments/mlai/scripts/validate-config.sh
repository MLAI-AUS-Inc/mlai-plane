#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
deployment_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
env_file=${1:-"$deployment_dir/.env"}
compose_file="$deployment_dir/compose.yaml"
manifest_file="$deployment_dir/release-manifest.json"

if [ ! -f "$env_file" ]; then
  echo "Configuration file not found: $env_file" >&2
  exit 1
fi

duplicate_keys=$(LC_ALL=C awk -F= '
  /^[A-Za-z_][A-Za-z0-9_]*=/ {
    if (seen[$1]++) {
      duplicates[$1] = 1
    }
  }
  END {
    for (key in duplicates) {
      print key
    }
  }
' "$env_file" | LC_ALL=C sort)
if [ -n "$duplicate_keys" ]; then
  echo "Configuration contains duplicate assignments; effective values are ambiguous:" >&2
  printf '%s\n' "$duplicate_keys" >&2
  exit 1
fi

if grep -Eq '^[A-Z0-9_]+=.*REPLACE_WITH_' "$env_file"; then
  echo "Configuration still contains REPLACE_WITH_* placeholders." >&2
  exit 1
fi

if grep -Eq '^[[:space:]]*COOKIE_DOMAIN=' "$env_file"; then
  echo "COOKIE_DOMAIN must remain unset so Plane cookies are host-only." >&2
  exit 1
fi

if ! grep -Eq '^WEB_URL=https://[^[:space:]]+$' "$env_file"; then
  echo "WEB_URL must use HTTPS." >&2
  exit 1
fi

if ! grep -Eq '^CORS_ALLOWED_ORIGINS=https://[^,[:space:]]+$' "$env_file"; then
  echo "CORS_ALLOWED_ORIGINS must be one explicit HTTPS origin." >&2
  exit 1
fi

web_url=$(sed -n 's/^WEB_URL=//p' "$env_file")
cors_origin=$(sed -n 's/^CORS_ALLOWED_ORIGINS=//p' "$env_file")
if [ "$cors_origin" != "$web_url" ]; then
  echo "CORS_ALLOWED_ORIGINS must equal WEB_URL." >&2
  exit 1
fi

app_domain=$(sed -n 's/^APP_DOMAIN=//p' "$env_file")
if [ "$web_url" != "https://$app_domain" ]; then
  echo "WEB_URL must be the HTTPS origin for APP_DOMAIN." >&2
  exit 1
fi

for base_url_name in APP_BASE_URL SPACE_BASE_URL ADMIN_BASE_URL; do
  base_url=$(sed -n "s/^${base_url_name}=//p" "$env_file")
  if [ -n "$base_url" ] && [ "$base_url" != "$web_url" ]; then
    echo "$base_url_name must equal WEB_URL; Plane appends its own route prefix." >&2
    exit 1
  fi
done

for required_setting in \
  DEBUG=0 \
  PLANE_TELEMETRY_ENABLED=0 \
  ENABLE_SIGNUP=0 \
  DISABLE_WORKSPACE_CREATION=1 \
  ENABLE_MAGIC_LINK_LOGIN=0 \
  ENABLE_EMAIL_PASSWORD=1 \
  MINIO_ENDPOINT_SSL=1 \
  SESSION_SAVE_EVERY_REQUEST=0; do
  if ! grep -qx "$required_setting" "$env_file"; then
    echo "Required safe setting is missing: $required_setting" >&2
    exit 1
  fi
done

if ! grep -q '^SESSION_COOKIE_NAME=__Host-plane-session$' "$env_file"; then
  echo "SESSION_COOKIE_NAME must be __Host-plane-session." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to validate the release manifest." >&2
  exit 1
fi

while IFS='|' read -r env_name manifest_query; do
  expected_value=$(jq -er "$manifest_query" "$manifest_file")
  configured_value=$(sed -n "s/^${env_name}=//p" "$env_file")
  if [ "$configured_value" != "$expected_value" ]; then
    echo "$env_name does not match release-manifest.json." >&2
    exit 1
  fi
done <<'EOF'
PLANE_RELEASE|.release
PLANE_UPSTREAM_COMMIT|.upstreamCommit
PLANE_FRONTEND_IMAGE|.images.frontend
PLANE_SPACE_IMAGE|.images.space
PLANE_ADMIN_IMAGE|.images.admin
PLANE_LIVE_IMAGE|.images.live
PLANE_BACKEND_IMAGE|.images.backend
PLANE_PROXY_IMAGE|.images.proxy
POSTGRES_IMAGE|.images.postgres
VALKEY_IMAGE|.images.valkey
RABBITMQ_IMAGE|.images.rabbitmq
MINIO_IMAGE|.images.minio
EOF

if ! grep -q '127.0.0.1:${LISTEN_HTTP_PORT:-8080}:80' "$compose_file"; then
  echo "The Plane proxy must remain bound to loopback for Tunnel-only access." >&2
  exit 1
fi

docker compose --env-file "$env_file" -f "$compose_file" config --quiet
echo "MLAI Plane configuration is valid."
