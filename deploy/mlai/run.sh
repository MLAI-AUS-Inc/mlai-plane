#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${PLANE_ENV_FILE:-$SCRIPT_DIR/.env}"
COMPOSE_FILE="$SCRIPT_DIR/compose.yml"
COMPOSE_PROJECT_NAME="${PLANE_COMPOSE_PROJECT_NAME:-mlai-plane}"
OPERATION_LOCK="${PLANE_OPERATION_LOCK:-/run/lock/mlai-plane.lock}"
SNAPSHOT_DIR=""

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_env_file() {
  [[ -f "$ENV_FILE" ]] || die "missing $ENV_FILE; copy .env.example and provide protected values"
}

compose() {
  require_env_file
  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" \
    "$@"
}

with_operation_lock() {
  local action="$1"
  shift
  command -v flock >/dev/null 2>&1 || die "flock is required for deployment and migration operations"
  exec 9>"$OPERATION_LOCK"
  flock -x 9
  "$action" "$@"
}

cleanup_snapshot() {
  if [[ -n "$SNAPSHOT_DIR" && -d "$SNAPSHOT_DIR" ]]; then
    rm -f -- "$SNAPSHOT_DIR/.env" "$SNAPSHOT_DIR/compose.yml"
    rmdir "$SNAPSHOT_DIR"
  fi
}

capture_configuration() {
  SNAPSHOT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mlai-plane-migration.XXXXXX")"
  trap cleanup_snapshot EXIT
  install -m 0600 "$ENV_FILE" "$SNAPSHOT_DIR/.env"
  install -m 0644 "$COMPOSE_FILE" "$SNAPSHOT_DIR/compose.yml"
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

env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

sha256_text() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

config() {
  require_env_file
  validate_images
  validate_placeholders
  compose config --quiet
}

migration_snapshot() {
  local backend_image compose_config_hash database_name database_user db_id db_system_id db_volume plan
  config
  backend_image="$(env_value PLANE_BACKEND_IMAGE)"
  database_name="$(env_value POSTGRES_DB)"
  database_user="$(env_value POSTGRES_USER)"
  compose_config_hash="$(compose config | sha256_text)"
  plan="$(compose --profile migration run --rm --no-TTY migrator python manage.py migrate --plan)"
  db_id="$(compose ps -q plane-db)"
  [[ -n "$db_id" ]] || die "database container is not running"
  db_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$db_id")"
  [[ -n "$db_volume" ]] || die "database volume identity is unavailable"
  db_system_id="$(
    compose exec -T plane-db psql \
      --host=/var/run/postgresql \
      --no-password \
      --username="$database_user" \
      --dbname="$database_name" \
      --tuples-only \
      --no-align \
      --command='SELECT system_identifier FROM pg_control_system();'
  )"
  [[ "$db_system_id" =~ ^[0-9]+$ ]] || die "database system identity is unavailable"
  printf 'backend_image=%s\ncompose_config_sha256=%s\ndatabase_volume=%s\ndatabase_system_identifier=%s\ndatabase_user=%s\ndatabase_name=%s\nplan:\n%s\n' \
    "$backend_image" "$compose_config_hash" "$db_volume" "$db_system_id" "$database_user" "$database_name" "$plan"
}

migration_plan_locked() {
  local snapshot approval
  snapshot="$(migration_snapshot)"
  approval="$(printf '%s' "$snapshot" | sha256_text)"
  printf '%s\n\nMIGRATION_APPROVAL_SHA256=%s\n' "$snapshot" "$approval"
}

migration_plan() {
  with_operation_lock migration_plan_locked
}

consume_migration_approval() {
  local count temporary
  count="$(grep -c '^PLANE_MIGRATION_APPROVAL=' "$ENV_FILE" || true)"
  [[ "$count" == "1" ]] || die "PLANE_MIGRATION_APPROVAL must occur exactly once in $ENV_FILE"
  temporary="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  chmod --reference="$ENV_FILE" "$temporary"
  awk '/^PLANE_MIGRATION_APPROVAL=/{print "PLANE_MIGRATION_APPROVAL="; next} {print}' \
    "$ENV_FILE" > "$temporary"
  mv "$temporary" "$ENV_FILE"
}

migrate_locked() {
  local approval="$1" configured_approval protected_compose protected_env snapshot current_approval
  require_env_file
  protected_env="$ENV_FILE"
  protected_compose="$COMPOSE_FILE"
  capture_configuration
  ENV_FILE="$SNAPSHOT_DIR/.env"
  COMPOSE_FILE="$SNAPSHOT_DIR/compose.yml"
  configured_approval="$(env_value PLANE_MIGRATION_APPROVAL)"
  [[ "$configured_approval" =~ ^[0-9a-f]{64}$ ]] || die "PLANE_MIGRATION_APPROVAL is not an approved plan hash"
  snapshot="$(migration_snapshot)"
  current_approval="$(printf '%s' "$snapshot" | sha256_text)"
  [[ "$approval" == "$configured_approval" ]] || die "operator approval does not match the protected target approval"
  [[ "$approval" == "$current_approval" ]] || die "migration image, target, or plan changed after approval"
  printf '%s\n' "$snapshot"
  ENV_FILE="$protected_env"
  COMPOSE_FILE="$protected_compose"
  [[ "$(env_value PLANE_MIGRATION_APPROVAL)" == "$approval" ]] || die "protected migration approval changed during validation"
  consume_migration_approval
  printf 'Migration approval %s was consumed before execution.\n' "$approval"
  ENV_FILE="$SNAPSHOT_DIR/.env"
  COMPOSE_FILE="$SNAPSHOT_DIR/compose.yml"
  compose --profile migration run --rm migrator
}

migrate() {
  local approval="${1:-}"
  [[ "$approval" =~ ^[0-9a-f]{64}$ ]] || die "usage: run.sh migrate <approved-plan-sha256>"
  with_operation_lock migrate_locked "$approval"
}

deploy_locked() {
  local pending_env="${1:-}"
  if [[ -n "$pending_env" ]]; then
    [[ "$pending_env" == "$SCRIPT_DIR/.env.pending" ]] || die "pending environment must be $SCRIPT_DIR/.env.pending"
    [[ -f "$pending_env" ]] || die "missing pending environment $pending_env"
    chmod 0600 "$pending_env"
    mv "$pending_env" "$ENV_FILE"
  fi
  config
  compose pull
  compose up -d --remove-orphans --no-build --wait --wait-timeout 240
  verify_api
}

deploy() {
  with_operation_lock deploy_locked "${1:-}"
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
  deploy) shift; deploy "$@" ;;
  migration-plan) migration_plan ;;
  migrate) shift; migrate "$@" ;;
  status) compose ps ;;
  logs) shift; compose logs "$@" ;;
  smoke) smoke ;;
  *)
    die "usage: run.sh {config|pull|deploy|migration-plan|migrate <approved-plan-sha256>|status|logs|smoke}"
    ;;
esac
