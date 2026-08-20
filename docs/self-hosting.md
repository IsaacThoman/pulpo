# Self-hosting Pulpo

Docker Compose is the supported starting point for a single-host Pulpo installation. The stack includes the web gateway, API, worker, PostgreSQL, Redis, and SeaweedFS object storage.

## Requirements

- Docker with Compose support
- A stable hostname for production
- Private random values for the database password, `ENCRYPTION_KEY`, and object-storage credentials
- An upstream model-provider credential configured after setup

## Start the stack

1. Copy `.env.example` to `.env` and replace every development secret.
2. Set `PUBLIC_URL` to the canonical URL users will open.
3. Set `COOKIE_SECURE=true` when the site is served over HTTPS.
4. Start Pulpo:

```bash
docker compose up --build -d
docker compose ps
```

Open `http://localhost:8080` for a local installation. An empty database presents a one-time setup page for the initial administrator.

After signing in, add a provider under **Admin → Providers**, upload reusable artwork under **Admin → Icons**, and create the labs and models users should see.

## Object storage

SeaweedFS is the default backend. A small installation can use local disk instead:

```dotenv
STORAGE_DRIVER=local
STORAGE_LOCAL_PATH=/app/data/objects
```

Mount a persistent volume at that path. For S3-compatible storage, `S3_ENDPOINT` is the internal API/worker address and `S3_PUBLIC_ENDPOINT` must be an HTTPS origin reachable by browsers. Allow `PUT`, `GET`, and `HEAD` from `PUBLIC_URL` in its CORS policy.

## Backups and upgrades

Back up PostgreSQL and object storage together. The admin export is useful for logical data export, but it is not an operator backup.

```bash
docker compose exec -T postgres pg_dump -U pulpo -Fc pulpo > pulpo-postgres.dump
docker compose exec -T postgres pg_dumpall -U pulpo --globals-only > pulpo-globals.sql
```

Practice restoring into a clean installation. Before upgrading, take a backup, build the target release, and run `docker compose up -d`; the API applies ordered migrations before accepting traffic.

## Next steps

- Automate administration with the [Pulpo CLI](/operations/cli).
- Understand the services in [Architecture](/concepts/architecture).
- Configure the optional commercial integration with [Billing operations](/billing).
