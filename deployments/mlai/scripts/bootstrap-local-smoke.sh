#!/usr/bin/env sh
set -eu

# This script is intentionally locked to the loopback-only staging origin. It
# creates disposable local acceptance data and must never be pointed at a remote
# or production Plane instance.
base_url=http://127.0.0.1:8080
public_host=plane-staging.mlai.au

instance_payload=$(curl --fail --silent --show-error \
  --header "Host: $public_host" "$base_url/api/instances/")
if ! printf '%s' "$instance_payload" | jq -e \
  '.instance.is_setup_done == false and
   .instance.current_version == "1.4.0" and
   .instance.is_telemetry_enabled == false and
   .config.enable_signup == false and
   .config.is_workspace_creation_disabled == true and
   .config.is_magic_login_enabled == false and
   .config.is_email_password_enabled == true' >/dev/null; then
  echo "Local instance is configured already or its safe runtime policy is not active." >&2
  exit 1
fi

csrf_payload=$(curl --fail --silent --show-error \
  --header "Host: $public_host" "$base_url/auth/get-csrf-token/")
csrf_token=$(printf '%s' "$csrf_payload" | jq -r '.csrf_token')
test -n "$csrf_token"

admin_password=$(openssl rand -base64 36)
# Plane's Django BooleanField expects the canonical title-cased form in this
# form-encoded endpoint.
signup_response=$(curl --silent --show-error --include \
  --cookie "csrftoken=$csrf_token" \
  --user-agent 'MLAI-Plane-Acceptance/1.0' \
  --header "Host: $public_host" \
  --header "Origin: https://$public_host" \
  --header "X-CSRFToken: $csrf_token" \
  --request POST \
  --data-urlencode 'email=plane-smoke@mlai.au' \
  --data-urlencode "password=$admin_password" \
  --data-urlencode 'first_name=Plane' \
  --data-urlencode 'last_name=Smoke' \
  --data-urlencode 'company_name=MLAI' \
  --data-urlencode 'is_telemetry_enabled=False' \
  "$base_url/api/instances/admins/sign-up/")
signup_status=$(printf '%s' "$signup_response" | awk 'NR == 1 { print $2 }')
admin_session=$(printf '%s' "$signup_response" | tr -d '\r' | sed -n 's/^[Ss]et-[Cc]ookie: admin-session-id=\([^;]*\).*/\1/p' | head -n 1)

if [ "$signup_status" != "302" ] || [ -z "$admin_session" ]; then
  echo "Local administrator bootstrap failed with HTTP $signup_status." >&2
  exit 1
fi

workspace_response=$(curl --silent --show-error --include \
  --cookie "admin-session-id=$admin_session" \
  --header "Host: $public_host" \
  --header 'Content-Type: application/json' \
  --request POST \
  --data '{"name":"MLAI","slug":"mlai","company_role":"Non-profit AI community"}' \
  "$base_url/api/instances/workspaces/")
workspace_status=$(printf '%s' "$workspace_response" | awk 'NR == 1 { print $2 }')
workspace_body=$(printf '%s' "$workspace_response" | tr -d '\r' | sed '1,/^$/d')
workspace_id=$(printf '%s' "$workspace_body" | jq -r '.id // empty')

if [ "$workspace_status" != "201" ] || [ -z "$workspace_id" ]; then
  echo "Local workspace bootstrap failed with HTTP $workspace_status." >&2
  exit 1
fi

signin_response=$(curl --silent --show-error --include \
  --cookie "csrftoken=$csrf_token" \
  --user-agent 'MLAI-Plane-Acceptance/1.0' \
  --header "Host: $public_host" \
  --header "Origin: https://$public_host" \
  --header "X-CSRFToken: $csrf_token" \
  --request POST \
  --data-urlencode 'email=plane-smoke@mlai.au' \
  --data-urlencode "password=$admin_password" \
  --data-urlencode 'next_path=/mlai/' \
  "$base_url/auth/sign-in/")
signin_status=$(printf '%s' "$signin_response" | awk 'NR == 1 { print $2 }')
plane_session_cookie_line=$(printf '%s' "$signin_response" | tr -d '\r' | sed -n '/^[Ss]et-[Cc]ookie: __Host-plane-session=/p' | head -n 1)
plane_session=$(printf '%s' "$plane_session_cookie_line" | sed -n 's/^[Ss]et-[Cc]ookie: __Host-plane-session=\([^;]*\).*/\1/p')
app_csrf=$(printf '%s' "$signin_response" | tr -d '\r' | sed -n 's/^[Ss]et-[Cc]ookie: csrftoken=\([^;]*\).*/\1/p' | head -n 1)

if [ "$signin_status" != "302" ] || [ -z "$plane_session" ] || [ -z "$app_csrf" ]; then
  echo "Local application sign-in failed with HTTP $signin_status." >&2
  exit 1
fi

plane_session_cookie_lower=$(printf '%s' "$plane_session_cookie_line" | tr '[:upper:]' '[:lower:]')
if printf '%s' "$plane_session_cookie_lower" | grep -Eq ';[[:space:]]*domain=' || \
  ! printf '%s' "$plane_session_cookie_lower" | grep -Eq ';[[:space:]]*secure([;[:space:]]|$)' || \
  ! printf '%s' "$plane_session_cookie_lower" | grep -Eq ';[[:space:]]*path=/([;[:space:]]|$)'; then
  echo "Plane session cookie is not Secure, host-only, and Path=/ as required." >&2
  exit 1
fi

app_cookies="csrftoken=$app_csrf; __Host-plane-session=$plane_session"
acceptance_suffix=$(openssl rand -hex 3 | tr '[:lower:]' '[:upper:]')
project_name="MLAI Acceptance $acceptance_suffix"
project_identifier="SMK$acceptance_suffix"
project_payload=$(jq -cn \
  --arg name "$project_name" \
  --arg identifier "$project_identifier" \
  '{name:$name,identifier:$identifier,description:"Disposable local acceptance project",network:0}')
project_response=$(curl --silent --show-error --include \
  --cookie "$app_cookies" \
  --user-agent 'MLAI-Plane-Acceptance/1.0' \
  --header "Host: $public_host" \
  --header "Origin: https://$public_host" \
  --header "X-CSRFToken: $app_csrf" \
  --header 'Content-Type: application/json' \
  --request POST \
  --data "$project_payload" \
  "$base_url/api/workspaces/mlai/projects/")
project_status=$(printf '%s' "$project_response" | awk 'NR == 1 { print $2 }')
project_body=$(printf '%s' "$project_response" | tr -d '\r' | sed '1,/^$/d')
project_id=$(printf '%s' "$project_body" | jq -r '.id // empty')

if [ "$project_status" != "201" ] || [ -z "$project_id" ]; then
  echo "Local project creation failed with HTTP $project_status." >&2
  exit 1
fi

project_get_response=$(curl --silent --show-error --include \
  --cookie "$app_cookies" \
  --user-agent 'MLAI-Plane-Acceptance/1.0' \
  --header "Host: $public_host" \
  "$base_url/api/workspaces/mlai/projects/$project_id/")
project_get_status=$(printf '%s' "$project_get_response" | awk 'NR == 1 { print $2 }')
project_get_body=$(printf '%s' "$project_get_response" | tr -d '\r' | sed '1,/^$/d')
if [ "$project_get_status" != "200" ] || ! printf '%s' "$project_get_body" | jq -e --arg identifier "$project_identifier" '.identifier == $identifier' >/dev/null; then
  echo "Local project read failed with HTTP $project_get_status." >&2
  exit 1
fi

project_patch_response=$(curl --silent --show-error --include \
  --cookie "$app_cookies" \
  --user-agent 'MLAI-Plane-Acceptance/1.0' \
  --header "Host: $public_host" \
  --header "Origin: https://$public_host" \
  --header "X-CSRFToken: $app_csrf" \
  --header 'Content-Type: application/json' \
  --request PATCH \
  --data '{"description":"Project update verified"}' \
  "$base_url/api/workspaces/mlai/projects/$project_id/")
project_patch_status=$(printf '%s' "$project_patch_response" | awk 'NR == 1 { print $2 }')
project_patch_body=$(printf '%s' "$project_patch_response" | tr -d '\r' | sed '1,/^$/d')
if [ "$project_patch_status" != "200" ] || ! printf '%s' "$project_patch_body" | jq -e '.description == "Project update verified"' >/dev/null; then
  echo "Local project update failed with HTTP $project_patch_status." >&2
  exit 1
fi

states_response=$(curl --silent --show-error --include \
  --cookie "$app_cookies" \
  --user-agent 'MLAI-Plane-Acceptance/1.0' \
  --header "Host: $public_host" \
  "$base_url/api/workspaces/mlai/projects/$project_id/states/")
states_status=$(printf '%s' "$states_response" | awk 'NR == 1 { print $2 }')
states_body=$(printf '%s' "$states_response" | tr -d '\r' | sed '1,/^$/d')
state_id=$(printf '%s' "$states_body" | jq -r '(if type == "object" then .results else . end)[] | select(.default == true) | .id' | head -n 1)

if [ "$states_status" != "200" ] || [ -z "$state_id" ]; then
  echo "Local default-state lookup failed with HTTP $states_status." >&2
  exit 1
fi

issue_payload=$(jq -cn --arg state "$state_id" '{name:"Acceptance work item",priority:"high",state_id:$state,description_html:"<p>Plane local acceptance</p>"}')
issue_response=$(curl --silent --show-error --include \
  --cookie "$app_cookies" \
  --user-agent 'MLAI-Plane-Acceptance/1.0' \
  --header "Host: $public_host" \
  --header "Origin: https://$public_host" \
  --header "X-CSRFToken: $app_csrf" \
  --header 'Content-Type: application/json' \
  --request POST \
  --data "$issue_payload" \
  "$base_url/api/workspaces/mlai/projects/$project_id/issues/")
issue_status=$(printf '%s' "$issue_response" | awk 'NR == 1 { print $2 }')
issue_body=$(printf '%s' "$issue_response" | tr -d '\r' | sed '1,/^$/d')
issue_id=$(printf '%s' "$issue_body" | jq -r '.id // empty')

if [ "$issue_status" != "201" ] || [ -z "$issue_id" ]; then
  echo "Local work-item creation failed with HTTP $issue_status." >&2
  exit 1
fi

attachment_response=$(curl --silent --show-error --include \
  --cookie "$app_cookies" \
  --user-agent 'MLAI-Plane-Acceptance/1.0' \
  --header "Host: $public_host" \
  --header "Origin: https://$public_host" \
  --header "X-CSRFToken: $app_csrf" \
  --header 'Content-Type: application/json' \
  --request POST \
  --data '{"name":"gateway-host-check.txt","type":"text/plain","size":64}' \
  "$base_url/api/assets/v2/workspaces/mlai/projects/$project_id/issues/$issue_id/attachments/")
attachment_status=$(printf '%s' "$attachment_response" | awk 'NR == 1 { print $2 }')
attachment_body=$(printf '%s' "$attachment_response" | tr -d '\r' | sed '1,/^$/d')
attachment_upload_url=$(printf '%s' "$attachment_body" | jq -r '.upload_data.url // empty')
case "$attachment_upload_url" in
  "https://$public_host/"*) ;;
  *)
    echo "Presigned upload URL did not use the public gateway host (HTTP $attachment_status)." >&2
    exit 1
    ;;
esac

issue_patch_response=$(curl --silent --show-error --include \
  --cookie "$app_cookies" \
  --user-agent 'MLAI-Plane-Acceptance/1.0' \
  --header "Host: $public_host" \
  --header "Origin: https://$public_host" \
  --header "X-CSRFToken: $app_csrf" \
  --header 'Content-Type: application/json' \
  --request PATCH \
  --data '{"name":"Acceptance work item updated","priority":"urgent"}' \
  "$base_url/api/workspaces/mlai/projects/$project_id/issues/$issue_id/")
issue_patch_status=$(printf '%s' "$issue_patch_response" | awk 'NR == 1 { print $2 }')
if [ "$issue_patch_status" != "204" ]; then
  echo "Local work-item update failed with HTTP $issue_patch_status." >&2
  exit 1
fi

issue_get_response=$(curl --silent --show-error --include \
  --cookie "$app_cookies" \
  --user-agent 'MLAI-Plane-Acceptance/1.0' \
  --header "Host: $public_host" \
  "$base_url/api/workspaces/mlai/projects/$project_id/issues/$issue_id/")
issue_get_status=$(printf '%s' "$issue_get_response" | awk 'NR == 1 { print $2 }')
issue_get_body=$(printf '%s' "$issue_get_response" | tr -d '\r' | sed '1,/^$/d')
if [ "$issue_get_status" != "200" ] || ! printf '%s' "$issue_get_body" | jq -e '.name == "Acceptance work item updated" and .priority == "urgent"' >/dev/null; then
  echo "Local work-item read failed with HTTP $issue_get_status." >&2
  exit 1
fi

issue_delete_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --cookie "$app_cookies" \
  --user-agent 'MLAI-Plane-Acceptance/1.0' \
  --header "Host: $public_host" \
  --header "Origin: https://$public_host" \
  --header "X-CSRFToken: $app_csrf" \
  --request DELETE \
  "$base_url/api/workspaces/mlai/projects/$project_id/issues/$issue_id/")
if [ "$issue_delete_status" != "204" ]; then
  echo "Local work-item deletion failed with HTTP $issue_delete_status." >&2
  exit 1
fi

issue_deleted_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --cookie "$app_cookies" \
  --user-agent 'MLAI-Plane-Acceptance/1.0' \
  --header "Host: $public_host" \
  "$base_url/api/workspaces/mlai/projects/$project_id/issues/$issue_id/")
if [ "$issue_deleted_status" != "404" ]; then
  echo "Local work-item deletion verification failed with HTTP $issue_deleted_status." >&2
  exit 1
fi

project_delete_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --cookie "$app_cookies" \
  --user-agent 'MLAI-Plane-Acceptance/1.0' \
  --header "Host: $public_host" \
  --header "Origin: https://$public_host" \
  --header "X-CSRFToken: $app_csrf" \
  --request DELETE \
  "$base_url/api/workspaces/mlai/projects/$project_id/")
if [ "$project_delete_status" != "204" ]; then
  echo "Local project deletion failed with HTTP $project_delete_status." >&2
  exit 1
fi

project_deleted_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --cookie "$app_cookies" \
  --user-agent 'MLAI-Plane-Acceptance/1.0' \
  --header "Host: $public_host" \
  "$base_url/api/workspaces/mlai/projects/$project_id/")
if [ "$project_deleted_status" != "404" ]; then
  echo "Local project deletion verification failed with HTTP $project_deleted_status." >&2
  exit 1
fi

runtime_payload=$(curl --fail --silent --show-error \
  --header "Host: $public_host" "$base_url/api/instances/")
if ! printf '%s' "$runtime_payload" | jq -e \
  '.instance.is_setup_done == true and
   .instance.current_version == "1.4.0" and
   .instance.is_telemetry_enabled == false and
   .config.enable_signup == false and
   .config.is_workspace_creation_disabled == true and
   .config.is_magic_login_enabled == false and
   .config.is_email_password_enabled == true' >/dev/null; then
  echo "Post-acceptance runtime policy assertion failed." >&2
  exit 1
fi

echo "Local Plane acceptance passed: safe setup, public-host signing, project lifecycle, and work-item CRUD."
