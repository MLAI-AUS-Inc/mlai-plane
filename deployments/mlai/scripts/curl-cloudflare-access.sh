#!/usr/bin/env sh

# Source this file, call configure_cloudflare_access, use curl_with_access, and
# call cleanup_cloudflare_access from the caller's trap. Credential values are
# read from protected files and passed to curl through a mode-0600 config file,
# never through argv or environment values.

cf_access_curl_config=

configure_cloudflare_access() {
  requirement=${1:-optional}
  client_id_file=${CF_ACCESS_CLIENT_ID_FILE:-}
  client_secret_file=${CF_ACCESS_CLIENT_SECRET_FILE:-}

  if [ -z "$client_id_file" ] && [ -z "$client_secret_file" ]; then
    if [ "$requirement" = "required" ]; then
      echo "Cloudflare Access service-token files are required." >&2
      echo "Set CF_ACCESS_CLIENT_ID_FILE and CF_ACCESS_CLIENT_SECRET_FILE to protected files." >&2
      return 1
    fi
    return 0
  fi

  if [ -z "$client_id_file" ] || [ -z "$client_secret_file" ] || \
    [ ! -r "$client_id_file" ] || [ ! -r "$client_secret_file" ]; then
    echo "Both Cloudflare Access credential files must exist and be readable." >&2
    return 1
  fi

  client_id=$(cat "$client_id_file")
  client_secret=$(cat "$client_secret_file")
  if ! printf '%s\n' "$client_id" | grep -Eq '^[A-Za-z0-9._~-]+$' || \
    ! printf '%s\n' "$client_secret" | grep -Eq '^[A-Za-z0-9._~-]+$'; then
    echo "Cloudflare Access credential files contain an invalid value." >&2
    client_id=
    client_secret=
    return 1
  fi

  old_umask=$(umask)
  umask 077
  cf_access_curl_config=$(mktemp "${TMPDIR:-/tmp}/mlai-plane-access.XXXXXX")
  umask "$old_umask"
  {
    printf 'header = "CF-Access-Client-Id: %s"\n' "$client_id"
    printf 'header = "CF-Access-Client-Secret: %s"\n' "$client_secret"
  } > "$cf_access_curl_config"
  chmod 600 "$cf_access_curl_config"
  client_id=
  client_secret=
}

curl_with_access() {
  if [ -n "$cf_access_curl_config" ]; then
    curl --config "$cf_access_curl_config" "$@"
  else
    curl "$@"
  fi
}

cleanup_cloudflare_access() {
  if [ -n "$cf_access_curl_config" ]; then
    rm -f "$cf_access_curl_config"
    cf_access_curl_config=
  fi
}
