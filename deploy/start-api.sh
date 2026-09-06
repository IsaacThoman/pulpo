#!/bin/sh
set -eu

# The replacement container migrates using its own release's SQL while the
# old API continues serving. A failed migration never starts the new listener.
node apps/server/dist/database/migrate.js
exec node apps/server/dist/api.js
