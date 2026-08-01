#!/usr/bin/env sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: CONFIRM_PLANE_INITIAL_SETUP=configure|resume $0 https://plane-staging.mlai.au admin@example.org" >&2
  exit 1
fi

setup_mode=${CONFIRM_PLANE_INITIAL_SETUP:-}
case "$setup_mode" in
  configure|resume) ;;
  *) echo "Use CONFIRM_PLANE_INITIAL_SETUP=configure for first setup or =resume after a partial workspace failure." >&2; exit 1 ;;
esac

base_url=${1%/}
admin_email=$2
case "$base_url" in
  https://plane-staging.mlai.au|https://admin.mlai.au) ;;
  *) echo "Initial setup is restricted to an approved MLAI Plane HTTPS origin." >&2; exit 1 ;;
esac
case "$admin_email" in
  *@*) ;;
  *) echo "A valid administrator email address is required." >&2; exit 1 ;;
esac
if [ ! -t 0 ]; then
  echo "Run initial setup interactively so the password is never passed in argv or environment." >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$script_dir/curl-cloudflare-access.sh"
configure_cloudflare_access required

terminal_hidden=0
restore_terminal() {
  if [ "$terminal_hidden" -eq 1 ]; then
    stty echo
    printf '\n' >&2
  fi
}
cleanup() {
  restore_terminal
  cleanup_cloudflare_access
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

printf 'Initial Plane administrator password: ' >&2
stty -echo
terminal_hidden=1
IFS= read -r admin_password
stty echo
terminal_hidden=0
printf '\n' >&2

printf 'Initial Plane administrator password (again): ' >&2
stty -echo
terminal_hidden=1
IFS= read -r admin_password_confirmation
stty echo
terminal_hidden=0
printf '\n' >&2

if [ "$admin_password" != "$admin_password_confirmation" ]; then
  admin_password=
  admin_password_confirmation=
  echo "Passwords did not match; no request was sent." >&2
  exit 1
fi
admin_password_confirmation=

if [ "${#admin_password}" -lt 16 ]; then
  echo "Use a unique password of at least 16 characters." >&2
  exit 1
fi

instance_payload=$(curl_with_access --fail --silent --show-error --max-time 30 "$base_url/api/instances/")
if ! printf '%s' "$instance_payload" | jq -e \
  '.instance.current_version == "1.4.0" and
   .instance.is_telemetry_enabled == false and
   .config.enable_signup == false and
   .config.is_workspace_creation_disabled == true and
   .config.is_magic_login_enabled == false and
   .config.is_email_password_enabled == true' >/dev/null; then
  echo "Pre-setup release, telemetry, or authentication policy assertion failed." >&2
  exit 1
fi
is_setup_done=$(printf '%s' "$instance_payload" | jq -r '.instance.is_setup_done')
if [ "$setup_mode" = "configure" ] && [ "$is_setup_done" != "false" ]; then
  echo "Plane is already configured; use the explicitly confirmed resume mode only for a partial workspace failure." >&2
  exit 1
fi
if [ "$setup_mode" = "resume" ] && [ "$is_setup_done" != "true" ]; then
  echo "Plane is not configured yet; resume mode refused." >&2
  exit 1
fi

csrf_payload=$(curl_with_access --fail --silent --show-error --max-time 30 "$base_url/auth/get-csrf-token/")
csrf_token=$(printf '%s' "$csrf_payload" | jq -r '.csrf_token')
test -n "$csrf_token"

if [ "$setup_mode" = "configure" ]; then
  auth_payload=$(jq -rn \
    --arg email "$admin_email" \
    --arg password "$admin_password" \
    '"email=\($email|@uri)&password=\($password|@uri)&first_name=MLAI&last_name=Administrator&company_name=MLAI&is_telemetry_enabled=False"')
  auth_path=/api/instances/admins/sign-up/
else
  auth_payload=$(jq -rn \
    --arg email "$admin_email" \
    --arg password "$admin_password" \
    '"email=\($email|@uri)&password=\($password|@uri)"')
  auth_path=/api/instances/admins/sign-in/
fi
auth_response=$(printf '%s' "$auth_payload" | curl_with_access --silent --show-error --include --max-time 30 \
    --cookie "csrftoken=$csrf_token" \
    --user-agent 'MLAI-Plane-Initial-Setup/1.0' \
    --header "Origin: $base_url" \
    --header "X-CSRFToken: $csrf_token" \
    --header 'Content-Type: application/x-www-form-urlencoded' \
    --request POST \
    --data-binary @- \
    "$base_url$auth_path")
admin_password=
auth_payload=

auth_status=$(printf '%s' "$auth_response" | awk 'NR == 1 { print $2 }')
admin_cookie_line=$(printf '%s' "$auth_response" | tr -d '\r' | sed -n '/^[Ss]et-[Cc]ookie: admin-session-id=/p' | head -n 1)
admin_session=$(printf '%s' "$admin_cookie_line" | sed -n 's/^[Ss]et-[Cc]ookie: admin-session-id=\([^;]*\).*/\1/p')
admin_cookie_lower=$(printf '%s' "$admin_cookie_line" | tr '[:upper:]' '[:lower:]')
if [ "$auth_status" != "302" ] || [ -z "$admin_session" ] || \
  printf '%s' "$admin_cookie_lower" | grep -Eq ';[[:space:]]*domain=' || \
  ! printf '%s' "$admin_cookie_lower" | grep -Eq ';[[:space:]]*secure([;[:space:]]|$)' || \
  ! printf '%s' "$admin_cookie_lower" | grep -Eq ';[[:space:]]*path=/([;[:space:]]|$)'; then
  echo "Initial administrator authentication or cookie-policy assertion failed (HTTP $auth_status)." >&2
  exit 1
fi

workspace_list=$(curl_with_access --fail --silent --show-error --max-time 30 \
  --cookie "admin-session-id=$admin_session" \
  --user-agent 'MLAI-Plane-Initial-Setup/1.0' \
  "$base_url/api/instances/workspaces/?search=MLAI")
if ! printf '%s' "$workspace_list" | jq -e \
  '(if type == "object" and has("results") then .results else . end)[]? | select(.slug == "mlai")' \
  >/dev/null; then
  workspace_response=$(curl_with_access --silent --show-error --include --max-time 30 \
    --cookie "admin-session-id=$admin_session" \
    --user-agent 'MLAI-Plane-Initial-Setup/1.0' \
    --header 'Content-Type: application/json' \
    --request POST \
    --data '{"name":"MLAI","slug":"mlai","company_role":"Non-profit AI community"}' \
    "$base_url/api/instances/workspaces/")
  workspace_status=$(printf '%s' "$workspace_response" | awk 'NR == 1 { print $2 }')
  if [ "$workspace_status" != "201" ]; then
    echo "Initial MLAI workspace creation failed (HTTP $workspace_status)." >&2
    echo "After correcting the cause, rerun with CONFIRM_PLANE_INITIAL_SETUP=resume." >&2
    exit 1
  fi
fi

runtime_payload=$(curl_with_access --fail --silent --show-error --max-time 30 "$base_url/api/instances/")
if ! printf '%s' "$runtime_payload" | jq -e \
  '.instance.current_version == "1.4.0" and
   .instance.is_setup_done == true and
   .instance.is_telemetry_enabled == false and
   .config.enable_signup == false and
   .config.is_workspace_creation_disabled == true and
   .config.is_magic_login_enabled == false and
   .config.is_email_password_enabled == true' \
  >/dev/null; then
  echo "Post-setup release, setup, telemetry, or authentication policy assertion failed. Stop the deployment and investigate." >&2
  exit 1
fi

cleanup
trap - 0 HUP INT TERM
echo "Initial MLAI Plane administrator and workspace are configured with the safe runtime policy."
