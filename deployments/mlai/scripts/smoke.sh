#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 https://gateway-hostname" >&2
  exit 1
fi

base_url=${1%/}
case "$base_url" in
  https://*) ;;
  *) echo "Smoke tests must target the HTTPS edge gateway, not the direct origin." >&2; exit 1 ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$script_dir/curl-cloudflare-access.sh"
configure_cloudflare_access required

temp_dir=
cleanup() {
  cleanup_cloudflare_access
  if [ -n "$temp_dir" ]; then
    rm -rf "$temp_dir"
  fi
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

temp_dir=$(mktemp -d)
headers_file="$temp_dir/headers"
instance_file="$temp_dir/instance.json"

root_status=$(curl_with_access --fail --silent --show-error --max-time 30 \
  --dump-header "$headers_file" --output /dev/null --write-out '%{http_code}' "$base_url/")
if [ "$root_status" != "200" ]; then
  echo "Expected gateway root HTTP 200, received $root_status." >&2
  exit 1
fi

if grep -Ei '^set-cookie:.*domain=\.?mlai\.au([;[:space:]]|$)' "$headers_file" >/dev/null; then
  echo "Unsafe parent-domain cookie observed." >&2
  exit 1
fi

if ! grep -Ei '^x-robots-tag:.*noindex' "$headers_file" >/dev/null; then
  echo "Expected X-Robots-Tag noindex header was not observed." >&2
  exit 1
fi

if ! grep -Ei '^x-frame-options:[[:space:]]*DENY' "$headers_file" >/dev/null; then
  echo "Expected X-Frame-Options DENY header was not observed." >&2
  exit 1
fi

instance_status=$(curl_with_access --fail --silent --show-error --max-time 30 \
  --output "$instance_file" --write-out '%{http_code}' "$base_url/api/instances/")
if [ "$instance_status" != "200" ] || ! jq -e \
  '.instance.current_version == "1.4.0" and
   .instance.is_setup_done == true and
   .instance.is_telemetry_enabled == false and
   .config.enable_signup == false and
   .config.is_workspace_creation_disabled == true and
   .config.is_magic_login_enabled == false and
   .config.is_email_password_enabled == true' \
  "$instance_file" >/dev/null; then
  echo "Plane runtime release, setup, telemetry, or authentication policy assertion failed." >&2
  exit 1
fi

echo "Gateway and Plane runtime smoke test passed for $base_url"
