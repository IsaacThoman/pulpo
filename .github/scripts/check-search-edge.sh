#!/usr/bin/env bash
set -euo pipefail

search_url="${1:?Search frontend URL is required}"
search_url="${search_url%/}"
curl --fail --silent --show-error --retry 5 --retry-all-errors --max-time 10 "$search_url/ready" \
  | awk '$0 == "ready" { found = 1 } END { exit !found }'
curl --fail --silent --show-error --retry 5 --retry-all-errors --max-time 10 "$search_url/api/search/auth/session" \
  | jq -e 'type == "object" and has("user") and .user == null' >/dev/null
