# Production deployments

Production uses a persistent Coolify infrastructure application and three independent
Dockerfile applications. Local Compose and development/PR previews keep using
`compose.yaml`.

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
`pulpo-prod-seaweed-s3`. No infrastructure service publishes a host port.

Traefik routes `/api`, `/v1`, `/socket.io`, `/health`, and `/ready` on the public
hostname directly to the API. The web application handles remaining paths.
The API route needs higher priority than the web route and a sticky load-balancer
cookie for Socket.IO polling during container overlap. Both HTTP and HTTPS
routers are configured without forcing an HTTP redirect (Cloudflare can connect
over HTTP). Keep `traefik.docker.network=coolify` on application routes.

## Release ordering

The CI workflow serializes main releases. It captures the released commit and
deploys API, worker, and web from that exact SHA, using repository variables:

- `COOLIFY_PULPO_APP_UUID`: API application (never the legacy Compose resource)
- `COOLIFY_PULPO_WORKER_APP_UUID`: worker application
- `COOLIFY_PULPO_WEB_APP_UUID`: frontend application

Disable independent Git auto-deploy on these applications. The replacement API
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
