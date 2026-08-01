#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
deployment_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
source_file="$deployment_dir/env.example"
destination=${1:-"$deployment_dir/.env"}

if [ -e "$destination" ]; then
  echo "Refusing to overwrite existing configuration: $destination" >&2
  exit 1
fi

umask 077
django_secret=$(openssl rand -hex 48)
live_secret=$(openssl rand -hex 48)
postgres_password=$(openssl rand -hex 32)
rabbitmq_password=$(openssl rand -hex 32)
s3_access_key=$(openssl rand -hex 16)
s3_secret_key=$(openssl rand -hex 32)

awk \
  -v django_secret="$django_secret" \
  -v live_secret="$live_secret" \
  -v postgres_password="$postgres_password" \
  -v rabbitmq_password="$rabbitmq_password" \
  -v s3_access_key="$s3_access_key" \
  -v s3_secret_key="$s3_secret_key" '
  {
    gsub(/REPLACE_WITH_DJANGO_SECRET_KEY/, django_secret)
    gsub(/REPLACE_WITH_LIVE_SERVER_SECRET_KEY/, live_secret)
    gsub(/REPLACE_WITH_POSTGRES_PASSWORD/, postgres_password)
    gsub(/REPLACE_WITH_RABBITMQ_PASSWORD/, rabbitmq_password)
    gsub(/REPLACE_WITH_S3_ACCESS_KEY/, s3_access_key)
    gsub(/REPLACE_WITH_S3_SECRET_KEY/, s3_secret_key)
    print
  }
' "$source_file" > "$destination"

echo "Created private Plane configuration at $destination"
