#!/bin/sh
set -eu

# Coolify rewrites Compose service names to <service>-pr-<id> for preview
# deployments, but values interpolated before that rewrite keep their original
# names. Resolve SeaweedFS's advertised peer addresses inside the container,
# where Coolify's branch metadata is available.
coolify_preview_id() {
  coolify_branch=${COOLIFY_BRANCH:-}
  coolify_branch=${coolify_branch#\"}
  coolify_branch=${coolify_branch%\"}
  coolify_branch=${coolify_branch#\'}
  coolify_branch=${coolify_branch%\'}

  case "$coolify_branch" in
    pull/*/head)
      preview_id=${coolify_branch#pull/}
      preview_id=${preview_id%/head}
      case "$preview_id" in
        ''|0|*[!0-9]*) return 1 ;;
        *) printf '%s' "$preview_id" ;;
      esac
      ;;
    *) return 1 ;;
  esac
}

resolve_service_host() {
  configured_host=$1
  base_host=$2

  if preview_id=$(coolify_preview_id); then
    printf '%s-pr-%s' "$base_host" "$preview_id"
  else
    printf '%s' "$configured_host"
  fi
}

case "${1:-}" in
  master)
    shift
    master_host=$(resolve_service_host "${SERVICE_NAME_SEAWEED_MASTER:-seaweed-master}" seaweed-master)
    set -- master "-ip=$master_host" "$@"
    ;;
  volume)
    shift
    master_host=$(resolve_service_host "${SERVICE_NAME_SEAWEED_MASTER:-seaweed-master}" seaweed-master)
    volume_host=$(resolve_service_host "${SERVICE_NAME_SEAWEED_VOLUME:-seaweed-volume}" seaweed-volume)
    set -- volume "-mserver=$master_host:9333" "-ip=$volume_host" "$@"
    ;;
  filer)
    shift
    master_host=$(resolve_service_host "${SERVICE_NAME_SEAWEED_MASTER:-seaweed-master}" seaweed-master)
    filer_host=$(resolve_service_host "${SERVICE_NAME_SEAWEED_FILER:-seaweed-filer}" seaweed-filer)
    set -- filer "-master=$master_host:9333" "-ip=$filer_host" "$@"
    ;;
  s3)
    shift
    filer_host=$(resolve_service_host "${SERVICE_NAME_SEAWEED_FILER:-seaweed-filer}" seaweed-filer)
    set -- s3 "-filer=$filer_host:8888" "$@"
    ;;
esac

exec /entrypoint.sh "$@"
