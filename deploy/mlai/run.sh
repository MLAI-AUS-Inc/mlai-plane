#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${PLANE_ENV_FILE:-$SCRIPT_DIR/.env}"
COMPOSE_FILE="$SCRIPT_DIR/compose.yml"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_env_file() {
  [[ -f "$ENV_FILE" ]] || die "missing $ENV_FILE; copy .env.example and provide protected values"
}

compose() {
  require_env_file
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

validate_images() {
  local key value
  local keys=(
    PLANE_FRONTEND_IMAGE
    PLANE_ADMIN_IMAGE
    PLANE_SPACE_IMAGE
    PLANE_LIVE_IMAGE
    PLANE_BACKEND_IMAGE
    PLANE_PROXY_IMAGE
  )

  for key in "${keys[@]}"; do
    value="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1)"
    [[ "$value" =~ ^ghcr\.io/mlai-aus-inc/mlai-plane-[a-z-]+@sha256:[0-9a-f]{64}$ ]] ||
      die "$key must be an MLAI GHCR image pinned by full sha256 digest"
    [[ "$value" != *@sha256:0000000000000000000000000000000000000000000000000000000000000000 ]] ||
      die "$key still contains the example digest"
  done
}

validate_placeholders() {
  if grep -Eq '=replace-with-' "$ENV_FILE"; then
    die "$ENV_FILE still contains a replace-with-* placeholder"
  fi
}

config() {
  require_env_file
  validate_images
  validate_placeholders
  compose config --quiet
}

migration_plan() {
  config
  compose --profile migration run --rm migrator python manage.py migrate --plan
}

migrate() {
  local approval="${1:-}"
  [[ -n "$approval" ]] || die "usage: run.sh migrate <exact-approved-change-id>"
  require_env_file
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
  [[ -n "${PLANE_MIGRATION_APPROVAL:-}" ]] || die "PLANE_MIGRATION_APPROVAL is not set"
  [[ "$approval" == "$PLANE_MIGRATION_APPROVAL" ]] || die "migration approval does not match this target"
  config
  compose --profile migration run --rm migrator
}

deploy() {
  config
  compose pull
  compose up -d --remove-orphans --no-build --wait --wait-timeout 240
  verify_api
}

verify_api() {
  local api_id api_health
  api_id="$(compose ps -q api)"
  [[ -n "$api_id" ]] || die "API container is not running"
  api_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$api_id")"
  [[ "$api_health" == "healthy" ]] || die "API container is not healthy (status: $api_health)"
  compose exec -T api python -c \
    "import json, urllib.request; response = urllib.request.urlopen('http://127.0.0.1:8000/', timeout=5); assert response.status == 200; assert json.load(response).get('status') == 'OK'"
}

smoke() {
  local url
  require_env_file
  verify_api
  url="$(sed -n 's/^WEB_URL=//p' "$ENV_FILE" | tail -n 1)"
  [[ "$url" =~ ^https://[^/]+$ ]] || die "WEB_URL must be an HTTPS origin without a path"
  curl --fail --silent --show-error --location --max-time 30 "$url/" >/dev/null
}

case "${1:-}" in
  config) config ;;
  pull) config; compose pull ;;
  deploy) deploy ;;
  migration-plan) migration_plan ;;
  migrate) shift; migrate "$@" ;;
  status) compose ps ;;
  logs) shift; compose logs "$@" ;;
  smoke) smoke ;;
  *)
    die "usage: run.sh {config|pull|deploy|migration-plan|migrate <approval-id>|status|logs|smoke}"
    ;;
esac
