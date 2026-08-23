# Self-hosting Pulpo

Pulpo supports a single-host Docker Compose installation with local attachment
storage. This is the recommended starting point for personal and small
noncommercial deployments.

::: warning Review the license
Pulpo is source-available under the
[Pulpo Noncommercial License](https://github.com/IsaacThoman/pulpo/blob/main/LICENSE.md).
For-profit internal use, commercial hosting, and Billing Features require
separate written permission.
:::

## Requirements

- A Linux, macOS, or Windows host capable of running Linux containers
- Docker Engine or Docker Desktop with the Compose plugin
- Git and OpenSSL
- At least 2 GiB of available memory for a small installation
- An HTTPS domain and reverse proxy for access beyond the local machine

Agent workspaces are optional and are not part of the Compose installation.
They require Kubernetes and a sandboxed runtime such as Kata Containers.

## Install locally

Clone Pulpo and generate a deployment configuration:

```bash
git clone https://github.com/IsaacThoman/pulpo.git
cd pulpo
git checkout "$(git tag --list 'v*' --sort=-version:refname | head -n 1)"
./scripts/self-host-init.sh
```

The initializer creates `.env.selfhost` with mode `0600`, a random Postgres
password, and a random encryption key. It never prints the secrets. Review the
file, then start Pulpo:

```bash
docker compose -f compose.selfhost.yaml --env-file .env.selfhost up --build -d
docker compose -f compose.selfhost.yaml --env-file .env.selfhost ps
```

Open `http://localhost:8080`. Pulpo will ask you to create the first
administrator. Initial administrator creation is locked at the database level,
so concurrent requests cannot create multiple initial administrators.

The stack contains:

| Service | Purpose |
| --- | --- |
| `web` | Static web client and reverse proxy to the API |
| `api` | HTTP, WebSocket, authentication, and management API |
| `worker` | Model generations, exports, backups, and maintenance jobs |
| `migrate` | One-shot database migration gate |
| `postgres` | Durable application data |
| `redis` | Durable job queue and realtime coordination |

Attachments use the `object_data` Docker volume by default. Postgres and Redis
use their own named volumes. The API and worker do not start until migrations
complete successfully.

## Configure the first model

A new instance intentionally has no enabled model. After creating the initial
administrator:

1. Open **Admin → Providers** and add an OpenAI-compatible API base URL and key.
2. Test the provider connection and refresh its upstream model list.
3. Open **Admin → Models**, create a model, and enable and expose it.
4. Optionally select default and favorite models under **Admin → Settings**.

`OPENAI_API_KEY` is not a bootstrap setting. Provider credentials are entered
through the administration UI or management API and encrypted with
`ENCRYPTION_KEY` before being stored in Postgres.

## Put Pulpo behind HTTPS

Run the initializer with the final public URL before the first start:

```bash
./scripts/self-host-init.sh https://chat.example.com
```

This sets `PUBLIC_URL` and enables secure session cookies. The self-host stack
binds to `127.0.0.1:8080` by default. A minimal Caddy configuration is:

```text
chat.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

Pulpo uses long-lived streaming responses and WebSockets. If you use another
proxy, preserve `Host`, `X-Forwarded-Proto`, and WebSocket upgrade headers, and
disable response buffering for `/api`, `/v1`, and `/socket.io`.

Do not expose the API, Postgres, or Redis containers directly. To serve Pulpo on
a trusted LAN without a reverse proxy, set `PULPO_BIND_ADDRESS=0.0.0.0`, but
production mobile clients and passkeys require HTTPS for non-localhost domains.

Changing `PUBLIC_URL` later changes the allowed browser origin and passkey
relying-party identity. Plan a domain change before registering passkeys.

## Configuration reference

The initializer copies `.env.selfhost.example` to `.env.selfhost`. Important
settings are:

| Setting | Purpose |
| --- | --- |
| `PUBLIC_URL` | Canonical browser and mobile URL; use the externally visible HTTPS origin |
| `INSTANCE_NAME` | Name shown to clients and authenticator applications |
| `ENCRYPTION_KEY` | Encrypts provider and tool secrets; back it up separately and do not rotate it casually |
| `POSTGRES_*` | Database name and credentials for the bundled Postgres service |
| `COOKIE_SECURE` | Must be `true` for an HTTPS deployment |
| `PULPO_BIND_ADDRESS` | Host interface for the web gateway; defaults to loopback |
| `PULPO_HTTP_PORT` | Host port for the web gateway; defaults to `8080` |
| `PULPO_CLIENT_MAX_BODY_SIZE` | Nginx request-body limit; increase it when enabling larger local uploads |
| `SESSION_TTL_DAYS` | Browser and native session lifetime |
| `LOG_LEVEL` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent` |
| `SMTP_URL` | Optional SMTP connection URL for password reset email |
| `SMTP_FROM` | Sender used for account email |
| `ALLOW_PRIVATE_PROVIDER_URLS` | Allows provider URLs on private networks; leave false unless intentionally using a local provider |

Keep `.env.selfhost` out of source control and store an encrypted copy with your
backups. A restored database cannot decrypt provider keys, two-factor secrets,
or tool credentials without the original `ENCRYPTION_KEY`.

The default attachment limit is 25 MiB in both Pulpo and the bundled Nginx
gateway. If an administrator raises Pulpo's application limit while using local
storage, raise `PULPO_CLIENT_MAX_BODY_SIZE` to the same or a larger value and
recreate the web container. Direct browser uploads to S3 do not pass through
the gateway.

### External S3-compatible storage

Local storage is simplest for one Docker host. To use S3, MinIO, R2, or another
compatible service, change `STORAGE_DRIVER=s3` and add:

```text
S3_ENDPOINT=https://internal-s3.example.com
S3_PUBLIC_ENDPOINT=https://objects.example.com
S3_REGION=us-east-1
S3_BUCKET=pulpo
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true
S3_CONFIGURE_CORS=true
```

`S3_ENDPOINT` must be reachable from the API and worker.
`S3_PUBLIC_ENDPOINT` must be reachable from every user's browser because Pulpo
uses presigned upload and download URLs. Review the provider's backup,
versioning, retention, and CORS behavior before migrating existing objects.

## Routine operations

Use the same Compose file and environment file for every command:

```bash
docker compose -f compose.selfhost.yaml --env-file .env.selfhost ps
docker compose -f compose.selfhost.yaml --env-file .env.selfhost logs --tail=200 api worker
docker compose -f compose.selfhost.yaml --env-file .env.selfhost restart api worker
docker compose -f compose.selfhost.yaml --env-file .env.selfhost down
```

`down` preserves named volumes. Do not add `--volumes` unless you intend to
delete the database, queue, and local attachments.

The web gateway exposes `/health`. Container health can be inspected with
`docker compose ps`. Application logs are structured and written to standard
output; Pulpo does not send logs or telemetry to the developer.

## Backups

Administrators can download an application backup from **Admin → Settings →
Database**. Store the downloaded archive off the Docker host. Application
backups do not contain `.env.selfhost` or `ENCRYPTION_KEY`.

For disaster recovery, also take infrastructure-level backups of:

- `.env.selfhost`, encrypted at rest;
- the `postgres_data` volume or a `pg_dump`;
- the `object_data` volume, or the external S3 bucket;
- optionally `redis_data` when retaining queued work matters.

Create a logical Postgres backup without placing the database password on the
command line:

```bash
docker compose -f compose.selfhost.yaml --env-file .env.selfhost exec -T postgres \
  sh -c 'pg_dump --username="$POSTGRES_USER" "$POSTGRES_DATABASE"' \
  > pulpo-postgres.sql
```

Test restore procedures periodically on an isolated host. Do not assume that a
database or application backup from a newer release can be restored directly
into an older release.

## Upgrade

Use tagged Pulpo releases for long-lived installations. Before an upgrade:

1. Download an application backup and preserve `.env.selfhost`.
2. Read the release notes for migration or configuration changes.
3. Fetch and check out the desired release tag.
4. Rebuild and restart the stack.

```bash
git fetch --tags origin
git checkout vX.Y.Z
docker compose -f compose.selfhost.yaml --env-file .env.selfhost build --pull
docker compose -f compose.selfhost.yaml --env-file .env.selfhost up -d
```

The `migrate` service runs first, and API and worker startup is blocked if a
migration fails. Database migrations are forward operations and may make a
source-code rollback unsafe; restore the pre-upgrade backup when release notes
do not explicitly support rollback.

## Mobile clients

The iOS app can switch to a custom Pulpo instance. Enter the same HTTPS
`PUBLIC_URL` used by the server. Instances whose domain was not compiled into
the app use the browser authorization-code flow for passkeys; other account and
chat features work normally.

## Troubleshooting

### The web container is unhealthy

Inspect API and migration state:

```bash
docker compose -f compose.selfhost.yaml --env-file .env.selfhost ps -a
docker compose -f compose.selfhost.yaml --env-file .env.selfhost logs --tail=200 migrate api
```

The most common causes are an invalid encryption key, unavailable Postgres, or
a migration failure.

### Login succeeds locally but not through the domain

Confirm that `PUBLIC_URL` exactly matches the browser origin, including scheme
and nonstandard port, and that `COOKIE_SECURE=true` for HTTPS. Re-run the
initializer only for a new installation; edit an existing `.env.selfhost`
instead so its encryption and database secrets are preserved.

### Uploads fail with S3 storage

Verify that the containers can reach `S3_ENDPOINT`, browsers can reach
`S3_PUBLIC_ENDPOINT`, the bucket credentials permit bucket and object
operations, and the public endpoint presents a valid TLS certificate.
