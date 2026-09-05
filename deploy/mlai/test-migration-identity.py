"""Offline regression test for the read-only database identity lookup."""

import subprocess
from pathlib import Path


source = Path(__file__).with_name("run.sh").read_text().split('case "${1:-}" in', 1)[0]
mocks = r'''
config() { :; }
env_value() {
  case "$1" in
    PLANE_BACKEND_IMAGE) echo 'ghcr.io/mlai-aus-inc/mlai-plane-backend@sha256:abc' ;;
    POSTGRES_DB|POSTGRES_USER) echo plane ;;
    *) exit 90 ;;
  esac
}
docker() {
  [[ "$1" == inspect ]] || exit 91
  echo mlai-plane_pgdata
}
compose() {
  case "$1" in
    config) echo 'stable configuration' ;;
    --profile)
      [[ "$*" == '--profile migration run --rm --no-TTY migrator python manage.py migrate --plan' ]] || exit 92
      echo 'db.0001_initial'
      ;;
    ps) echo database-container ;;
    exec)
      [[ "$*" == 'exec -T plane-db psql --host=/var/run/postgresql --no-password --username=plane --dbname=plane --tuples-only --no-align --command=SELECT system_identifier FROM pg_control_system();' ]] || exit 93
      echo "${TEST_DATABASE_ID:-123456789}"
      ;;
    *) exit 94 ;;
  esac
}
migration_plan_locked
'''
result = subprocess.run(["bash", "-c", source + mocks], capture_output=True, text=True)
assert result.returncode == 0, result.stderr
assert "database_system_identifier=123456789" in result.stdout
assert "database_volume=mlai-plane_pgdata" in result.stdout
assert "MIGRATION_APPROVAL_SHA256=" in result.stdout
result = subprocess.run(
    ["bash", "-c", source + 'TEST_DATABASE_ID=invalid\n' + mocks],
    capture_output=True, text=True,
)
assert result.returncode != 0
assert "MIGRATION_APPROVAL_SHA256=" not in result.stdout
print("Migration identity socket lookup and fail-closed checks passed")
