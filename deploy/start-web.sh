#!/bin/sh
set -eu

test -s /usr/share/nginx/html/index.html
printf 'ready\n' > /tmp/pulpo-web-ready
nginx -g 'daemon off;' &
nginx_pid=$!

shutdown() {
  trap '' TERM INT QUIT
  rm -f /tmp/pulpo-web-ready
  # Traefik probes /ready every 2s. Keep serving during its withdrawal window.
  sleep 5
  kill -QUIT "$nginx_pid" 2>/dev/null || true
  wait "$nginx_pid" || true
}

# The upstream nginx image uses SIGQUIT as its Docker stop signal.
trap shutdown TERM INT QUIT
wait "$nginx_pid" || true
