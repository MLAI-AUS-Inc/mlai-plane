#!/usr/bin/env sh
set -eu
umask 077

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /absolute/path/to/backup-directory" >&2
  exit 1
fi

output_dir=$1
case "$output_dir" in
  /*) ;;
  *) echo "Backup destination must be an absolute path." >&2; exit 1 ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
deployment_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
env_file="$deployment_dir/.env"
compose_file="$deployment_dir/compose.yaml"

services_stopped=0
restart_services() {
  if [ "$services_stopped" -eq 1 ]; then
    if ! docker compose --env-file "$env_file" -f "$compose_file" --profile bundled \
      up -d api worker beat-worker live proxy >/dev/null; then
      return 1
    fi
    services_stopped=0
  fi
}
cleanup() {
  exit_code=$?
  trap - 0
  if ! restart_services; then
    echo "ERROR: backup cleanup could not restart Plane application services." >&2
    exit_code=1
  fi
  exit "$exit_code"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

if [ -e "$output_dir" ]; then
  echo "Refusing to overwrite existing backup destination: $output_dir" >&2
  exit 1
fi

"$script_dir/validate-config.sh" "$env_file"
services_stopped=1
docker compose --env-file "$env_file" -f "$compose_file" --profile bundled \
  stop proxy api worker beat-worker live

mkdir -p "$output_dir/uploads"
docker compose --env-file "$env_file" -f "$compose_file" --profile bundled \
  exec -T plane-db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$output_dir/plane-postgres.dump"
docker compose --env-file "$env_file" -f "$compose_file" --profile bundled \
  cp plane-minio:/export/. "$output_dir/uploads"
cp "$deployment_dir/release-manifest.json" "$output_dir/release-manifest.json"
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$output_dir/completed-at.txt"

if ! restart_services; then
  echo "Backup data was written, but Plane application services failed to restart." >&2
  exit 1
fi
trap - 0 HUP INT TERM

echo "Bundled-state backup completed at $output_dir"
