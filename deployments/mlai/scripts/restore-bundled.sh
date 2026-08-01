#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: CONFIRM_PLANE_RESTORE=restore-bundled $0 /absolute/path/to/backup-directory" >&2
  exit 1
fi

if [ "${CONFIRM_PLANE_RESTORE:-}" != "restore-bundled" ]; then
  echo "Restore confirmation missing; no data was changed." >&2
  exit 1
fi

backup_dir=$1
case "$backup_dir" in
  /*) ;;
  *) echo "Backup source must be an absolute path." >&2; exit 1 ;;
esac

if [ ! -s "$backup_dir/plane-postgres.dump" ] || \
  [ ! -d "$backup_dir/uploads" ] || \
  [ ! -f "$backup_dir/release-manifest.json" ] || \
  [ ! -f "$backup_dir/completed-at.txt" ]; then
  echo "Backup is incomplete: dump, uploads, manifest, and completion marker are required." >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
deployment_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
env_file="$deployment_dir/.env"
compose_file="$deployment_dir/compose.yaml"

"$script_dir/validate-config.sh" "$env_file"
if ! cmp -s "$backup_dir/release-manifest.json" "$deployment_dir/release-manifest.json"; then
  echo "Backup release manifest does not match the checked-out deployment release." >&2
  exit 1
fi

docker compose --env-file "$env_file" -f "$compose_file" --profile bundled \
  cp "$backup_dir/plane-postgres.dump" plane-db:/tmp/plane-postgres.dump
if ! docker compose --env-file "$env_file" -f "$compose_file" --profile bundled \
  exec -T plane-db pg_restore --list /tmp/plane-postgres.dump >/dev/null; then
  echo "PostgreSQL dump preflight failed; no configured data was changed." >&2
  exit 1
fi

echo "This operation replaces data in the configured bundled staging stack." >&2
docker compose --env-file "$env_file" -f "$compose_file" --profile bundled \
  stop proxy api worker beat-worker live
docker compose --env-file "$env_file" -f "$compose_file" --profile bundled \
  exec -T plane-db sh -c 'dropdb --if-exists --force -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB" && pg_restore --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/plane-postgres.dump'
docker compose --env-file "$env_file" -f "$compose_file" --profile bundled \
  exec -T plane-minio sh -c 'rm -rf -- /export/* /export/.[!.]* /export/..?*'
docker compose --env-file "$env_file" -f "$compose_file" --profile bundled \
  cp "$backup_dir/uploads/." plane-minio:/export
docker compose --env-file "$env_file" -f "$compose_file" --profile bundled \
  exec -T plane-mq sh -ec 'rabbitmqctl -q list_queues name | while IFS= read -r queue_name; do if [ -n "$queue_name" ]; then rabbitmqctl -q purge_queue "$queue_name" >/dev/null; fi; done'
docker compose --env-file "$env_file" -f "$compose_file" --profile bundled \
  exec -T plane-redis valkey-cli FLUSHALL >/dev/null
docker compose --env-file "$env_file" -f "$compose_file" --profile bundled \
  up -d api worker beat-worker live proxy

echo "Bundled-state restore completed and application services restarted. Run smoke tests now."
