# Production deployments

Production uses a persistent Coolify infrastructure application and three independent
Dockerfile applications. Persistent development follows the same separation; see
[development deployments](development-deployments.md). Local Compose and disposable
PR previews use `compose.yaml`.

| Resource | Configuration | Health | Shutdown budget |
| --- | --- | --- | --- |
| Infrastructure | `deploy/compose.production-infra.yaml`, raw Compose mode | Postgres/Redis checks | Manual maintenance only |
| API | `apps/server/Dockerfile`, target `production-api` | HTTP `/ready`, Postgres + Redis | 30 seconds |
| Worker | Same Dockerfile, target `production-worker` | Private HTTP `:3000/ready`, consumers + Postgres + Redis | 900 seconds |
| Web | `Dockerfile.web`, target `production-web` | HTTP `/ready`, frontend exists | 30 seconds |

The infrastructure application reuses the original named external volumes. Set
`PULPO_DATA_PREFIX` to the original Coolify application UUID and retain its
Postgres/S3 credentials. Enable **Raw Docker Compose Deployment**: Coolify 4.3.10's normal parser rewrites named volume references even when they are declared external. Raw mode preserves these references. Verify the rendered mount sources before starting it. API and worker share that application's existing object
volume at `/app/data/objects`. Preserve `ENCRYPTION_KEY` and set `PULPO_INSTANCE_ID`
to the existing identity (`pulpo.baby` on this installation).

Services connect on the `coolify` network with unique `pulpo-prod-*` aliases.
API/worker use `pulpo-prod-postgres`, `pulpo-prod-redis`, `pulpo-prod-ollama`, and
`pulpo-prod-seaweed-s3`. No infrastructure service publishes a host port. Set the infrastructure's custom build command to `true`: it uses prebuilt images and needs no build-time secret interpolation.

Traefik routes `/api`, `/v1`, `/socket.io`, `/health`, and `/ready` on the public
hostname directly to the API. The web application handles remaining paths.
The API route needs higher priority than the web route and a sticky load-balancer
cookie for Socket.IO polling during container overlap. Both HTTP and HTTPS
routers are configured without forcing an HTTP redirect (Cloudflare can connect
over HTTP). Keep `traefik.docker.network=coolify` on application routes.

Both API and web Traefik services must actively probe `/ready` every 2 seconds
with a 1-second timeout (`loadbalancer.healthcheck.path`, `.interval`, `.timeout`).
Their shutdown handlers make readiness fail, continue serving for 5 seconds so
the proxy can withdraw that backend, and then drain connections. Docker's
startup health retries alone do not withdraw a shutting-down backend quickly
enough. When adding/changing these service settings on a live deployment, use
new router/service names and a higher priority for the first replacement to
avoid conflicting old/new Traefik definitions; keep those names stable afterward.

## Release ordering

The CI workflow serializes main releases. It captures the released commit and
deploys API, worker, and web from that exact SHA, using repository variables:

- `COOLIFY_PULPO_APP_UUID`: API application (never the legacy Compose resource)
- `COOLIFY_PULPO_WORKER_APP_UUID`: worker application
- `COOLIFY_PULPO_WEB_APP_UUID`: frontend application

Disable independent Git auto-deploy on these applications. Set
`COMPOSE_REMOVE_ORPHANS=false` in each application (build time and runtime).
Enabling orphan removal makes Compose delete the old release before the new
container becomes healthy, defeating rolling updates and failure recovery. The replacement API
runs `database/migrate.js` before opening its HTTP listener. That process takes a
PostgreSQL advisory lock, with a five-minute lock timeout, to prevent simultaneous
migration runners from racing. Drizzle applies pending SQL in its transaction.
The listener only starts on success. Coolify must wait for a passing readiness
check before removing the previous container. A failed API deployment stops the
workflow before worker/frontend deployment. The worker drains active jobs while
its replacement accepts new jobs; sockets can reconnect and replay persisted
events when the old API closes.

Configure Coolify's health checks to allow the migration/startup window (for
example 5-second intervals, 120 retries, and 5-second initial delay). Use the
Dockerfile health command or an equivalent Node `fetch` command for API/worker;
the slim Node image does not ship curl. Do not set a consistent/custom container
name or publish a host port, since those prevent rolling replacement.

## Migration compatibility and rollback

Migrations run while the previous API and worker remain active. Add new columns
and tables first, deploy compatible code, backfill separately when necessary,
and only remove obsolete fields after every running version stops using them.
Review DDL for long table locks; container overlap cannot prevent database locks.
Never edit an already-applied migration.

A failed migration leaves the previous app serving; a failed later deployment
can leave a mixture of versions, which must remain compatible. Rolling back an
image does not reverse migrations. Roll back API/worker/web only to versions
compatible with the current database schema.

During the one-time separation, preserve a private copy of the old Compose file,
runtime environment, container metadata, and a fresh database backup. Never run
old and new Postgres containers against the same data volume concurrently. Stop
the legacy application before starting the infrastructure application. For rollback,
stop the replacement infrastructure before bringing the saved legacy Compose
stack back up. Never remove its volumes. Keep the legacy resource stopped with
automatic deployment disabled after cutover.

## Client IPs behind Cloudflare Tunnel

Device sessions show the original sign-in IP and the latest IP observed on an
authenticated HTTP request or Socket.IO handshake. Existing sessions retain their
old sign-in address; historical proxy addresses cannot be reconstructed. The
latest address appears after the session next contacts the upgraded server.

Client IP detection is configured with server environment variables and takes
effect after restart. These variables also control the HTTP rate-limit key; they
do not enable trust of forwarded host or protocol headers.

- `PULPO_CLIENT_IP_MODE=direct` (default): ignore forwarded headers and use the TCP peer.
- `PULPO_CLIENT_IP_MODE=forwarded`: resolve `X-Forwarded-For` from the nearest proxy
  outward, stopping at the first address outside the trusted proxy list.
- `PULPO_CLIENT_IP_MODE=cloudflare`: use `CF-Connecting-IP` only when the TCP peer
  is trusted. Cloudflare Pseudo IPv4 overwrite is supported through its
  `CF-Connecting-IPv6` header.
- `PULPO_TRUSTED_PROXY_CIDRS`: comma-separated explicit IP addresses or CIDRs.
  Required in either proxy mode. Empty entries, aliases, hop counts, and blanket
  `/0` trust are rejected at startup.

For a tunnel connected directly to an API on the same host, an example is:

```dotenv
PULPO_CLIENT_IP_MODE=cloudflare
PULPO_TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
```

For `Cloudflare Tunnel → Traefik/nginx → API`, configure the actual address(es)
or dedicated ingress subnet of the proxy that connects to the API, rather than
Cloudflare's public edge ranges. For example, if the immediate reverse proxy has
address `172.30.0.5`, use `PULPO_TRUSTED_PROXY_CIDRS=172.30.0.5/32`. This is an
illustration, not an address to copy without checking your network. In forwarded
mode include every trusted intermediary needed to resolve the original visitor.

Keep the API private and make the trusted ingress reachable only through the
intended tunnel path. A trusted proxy must preserve Cloudflare's IP headers from
the tunnel and strip them on any alternate untrusted ingress. Trusting a Docker
subnet also trusts every container on that subnet, so prefer a dedicated network
or explicit proxy addresses. The development nginx configuration already forwards
request headers; production routes reach the API through Traefik directly.

Missing, malformed, or untrusted headers fall back to the TCP peer. Confirm the
configuration by signing in through the tunnel and checking **Settings → Devices**
against the visitor's public IP. Test separate visitors to verify that rate limits
are no longer shared under the tunnel/proxy IP. No IP geolocation is performed.

## Lossless conversation storage cutover (migration 0075)

Migration `0075_lossless_conversation_storage` changes conversation payload columns
from JSONB to serialized JSON in PostgreSQL `text`. Arbitrary tool output can
contain NULs or unpaired UTF-16 surrogates; parsing those payloads as JSONB rejects
otherwise accepted API requests. Application code encodes on write and decodes on
read, so clients and providers receive the original string values. Tool/OCR text
columns use JSON string serialization as well. Operational identifiers remain
ordinary text/UUIDs. Search passages are display-safe derivatives; they are not
used to replace authoritative conversation content.

This migration **requires a maintenance window**. The current automated rolling
API → worker → web deployment must not apply it while old instances are serving.
Before any migration or migration-recovery operation, the migration runner checks
for the old `responses.input` JSONB column. On an existing installation it exits
without changing the schema unless `PULPO_LOSSLESS_STORAGE_CUTOVER=1` is explicitly
provided to that migration invocation. Fresh databases need no acknowledgement;
subsequent starts after the conversion do not need it either. This guard applies
to development as well as production. A normal deployment encountering the guard
fails before replacing the running API and before deploying workers.

For each existing environment:

1. Pin the API and worker release to the same tested commit. Prepare images before
   the maintenance window when possible. Prevent concurrent automatic deployments
   for the duration of the cutover.
2. Block new HTTP and Socket.IO traffic at ingress, then drain and stop every API
   and worker instance, including overlapping containers. Allow active workers to
   finish within their configured shutdown budget; verify that no old consumers
   or database writers remain before proceeding. If draining fails, stop here.
3. Take a verified PostgreSQL backup while writers are stopped. Retain the old
   release identifiers and existing object volumes. Redis queues must remain
   intact so accepted, pending jobs can resume on the new worker.
4. Run the new release's migration command once with
   `PULPO_LOSSLESS_STORAGE_CUTOVER=1`. The acknowledgement confirms the prior steps;
   it does not itself stop traffic, drain workers, or create a backup. Remove it
   after the migration succeeds. Drizzle applies the conversion and its journal
   entry transactionally under the existing migration lock.
5. Start the new API and worker from the pinned commit, then update the web app.
   Verify `/ready`, worker readiness, and generation/retrieval of a synthetic tool
   result containing `\u0000`, confirming the original character round-trips.
   Reopen ingress only after those checks pass.

If the migration fails, its transaction rolls back; verify the database schema
before restoring service with old binaries. If migration succeeded but startup or
verification fails, keep ingress closed and repair the new release. **Do not
restart old binaries against the converted schema.** Reverting the schema requires
restoring the pre-cutover database backup while all writers remain stopped, with
queue reconciliation before old workers resume. Do not discard accepted queue
jobs automatically.

Full instance backups retain their version-1 logical representation. The backup
adapter decodes serialized storage columns before archiving and encodes them before
raw SQL restore; legacy archives remain supported. New archives containing NULs
require a release with lossless storage to restore. Detailed-payload retention and
temporary-chat exclusions apply before encoding and are unchanged.
