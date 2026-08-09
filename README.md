# Pulpo

Pulpo is a self-hostable, local-first interface and OpenAI-compatible gateway for the OpenAI Responses API. Chats feel immediate because recent query data, drafts, response cursors, and pending mutations live in IndexedDB; PostgreSQL remains authoritative and every tab reconciles through Socket.IO after reconnecting or waking.

## Architecture

- React 19, Vite, TanStack Query, Zustand, Dexie, and shared Zod contracts.
- Fastify API with secure cookie sessions and `/v1/responses` compatibility.
- Independent BullMQ worker that owns OpenAI streams after browsers disconnect.
- PostgreSQL for users, catalog, conversations, typed response items, accounting, and audit data.
- Redis for jobs, recent sequenced events, Socket.IO recovery, and replica fanout.
- SeaweedFS through its S3 API, or local disk through the same `BlobStore` interface.
- An nginx web gateway and Docker Compose for the supported self-hosted deployment.

The repository is organized as an npm-workspaces monorepo:

```text
apps/web/src/         React web application
apps/server/src/      API, worker, storage, accounting, and realtime services
apps/mobile/          Expo Router iPhone application
apps/cli/             Published Node.js management CLI
apps/server/drizzle/  ordered PostgreSQL migrations
packages/contracts/   shared Zod and Socket.IO contracts
packages/client-core/ platform-neutral chat and client behavior
packages/*/           other shared runtime and infrastructure packages
deploy/               nginx gateway configuration
```

## Quick start with Docker Compose

1. Copy `.env.example` to `.env` and replace every development secret. `ENCRYPTION_KEY`, the PostgreSQL password, and the S3 secret must be private random values.
2. Set `PUBLIC_URL` to the URL users will open. Set `COOKIE_SECURE=true` behind HTTPS.
3. Start Pulpo:

```bash
docker compose up --build -d
docker compose ps
```

Open `http://localhost:8080` by default. On an empty database, Pulpo presents a one-time setup page where you create the initial administrator. No default or environment-provided login is created. Add an OpenAI project connection under Admin → Providers, create a lab and model, configure pricing, and approve pending users.

## Management CLI

`@isaacthoman/pulpo` is the Node.js 22+ operator client for contexts, scoped automation tokens,
settings, catalog resources, users, usage/audit data, workspaces, banners, exports,
and backups. It deliberately does not expose restore or deployment mutation.

```bash
npm install --global @isaacthoman/pulpo
pulpo context add production --url https://pulpo.example.com
pulpo auth login --email admin@example.com
pulpo settings export --output pulpo-settings.json
pulpo --yes settings apply --file pulpo-settings.json
```

Use `--json` for scripting. `PULPO_CONTEXT`, `PULPO_URL`, and `PULPO_TOKEN`
override stored configuration; secrets in JSON inputs can use
`{ "fromEnv": "ENVIRONMENT_VARIABLE" }`. See `apps/cli/README.md` for the
complete command and credential-storage notes.

SeaweedFS is the default Compose storage backend. For a small single-host install, set:

```dotenv
STORAGE_DRIVER=local
STORAGE_LOCAL_PATH=/app/data/objects
```

and mount a persistent volume at that path. Any supported S3-compatible service can replace SeaweedFS by changing the `S3_*` values.

`S3_ENDPOINT` is the worker/API address and may use the Compose service name. `S3_PUBLIC_ENDPOINT` is embedded in presigned browser URLs; set it to an HTTPS object-storage origin reachable by users. The localhost default exposes SeaweedFS on port 8333 for single-host development. Configure that origin's S3 CORS policy to allow `PUT`, `GET`, and `HEAD` from `PUBLIC_URL` in production.

## Releases

Merges to `main` run the test, build, and lint suites before Semantic Release
examines commits since the previous `vX.Y.Z` tag. Conventional Commit types
determine the next version: `fix:` and `perf:` create a patch, `feat:` creates a
minor, and a breaking change creates a major release. Other commit types do not
publish a release.

Semantic Release creates the Git tag and GitHub Release, publishes `@isaacthoman/pulpo`
at the same version, then dispatches the agent workspace workflow for that exact
tag. The existing `v0.1.0` tag is the release baseline.

## Coolify deployment

Use `/compose.yaml` as the Docker Compose location. It exposes services only to
the internal Compose network, avoiding collisions with PostgreSQL, Redis, and
other workloads already using host ports. `compose.override.yaml` contains the
localhost bindings and is merged automatically only by normal local
`docker compose` commands. The web image serves the React application and
proxies API, Responses, health, and Socket.IO traffic to Fastify.

In Coolify:

1. Assign the Pulpo application domain to the `web` service on port `80`.
   Its nginx gateway routes `/api`, `/v1`, `/health`, and `/socket.io` to the
   API and serves the React application for other requests.
2. Assign a separate HTTPS object-storage domain to `seaweed-s3` on port
   `8333` when using the bundled SeaweedFS profile.
3. Set `PUBLIC_URL` to the Pulpo application origin, `S3_PUBLIC_ENDPOINT` to
   the object-storage origin, and `COOKIE_SECURE=true`.
4. Configure strong values for `POSTGRES_PASSWORD`, `ENCRYPTION_KEY`,
   `S3_ACCESS_KEY_ID`, and
   `S3_SECRET_ACCESS_KEY`. The API receives `POSTGRES_HOST`, `POSTGRES_PORT`,
   `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DATABASE` directly, so
   generated passwords do not need URL encoding. Set
   `PULPO_ENV_FILE=.env.example`; Coolify injects configured values at runtime.
5. Configure the health check on the `web` service as HTTP port `80`, path
   `/health`, expected status `200`.

No Pulpo service should publish `5432`, `6379`, `8080`, or `8333`
directly on the Coolify host.

## Local development

Node.js 22+, PostgreSQL 17, and Redis 7 are recommended.

```bash
npm install
docker compose up -d postgres redis
npm run db:migrate
npm run dev:api
npm run dev:worker
npm run dev
```

The Vite server runs at `http://127.0.0.1:5173` and proxies API and Socket.IO traffic to port 3000.

Validation commands:

```bash
npm run build
npm test
npm run lint
docker compose config --quiet
```

### iPhone app

The native client lives in `apps/mobile` and targets iPhone on iOS 26 with Expo
SDK 57. It connects to `https://pulpo.baby` by default and can switch to another
HTTPS Pulpo instance. To run it against the local Compose gateway:

```bash
docker compose up --build -d
EXPO_PUBLIC_DEFAULT_INSTANCE_URL=http://localhost:8080 npm run dev:mobile
```

Open the project in an iOS 26 simulator through Expo CLI. Local HTTP is accepted
only by development builds; preview and production builds require HTTPS. See
`apps/mobile/README.md` for EAS, Release build, and environment details.

## Local-first and realtime behavior

- The most recent 50 detailed chats are retained locally by default; users may choose 0–500 in Settings → Interface.
- Cached chats open immediately. TanStack Query revalidates in the background when the network is usable.
- Offline-safe chat and folder mutations enter an IndexedDB outbox with idempotency keys.
- Each tab has its own cursor. Events are deduplicated by response ID and sequence.
- Socket.IO recovery handles short interruptions. Redis replays recent gaps; PostgreSQL snapshots repair expired or large gaps.
- Worker ownership is independent of sockets. Closing every tab does not cancel generation.
- Background Responses resume from their upstream sequence after worker restart and fall back to retrieval polling.

## Public API

Create a scoped key in Pulpo and point an OpenAI SDK at Pulpo's `/v1` base URL.

```ts
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.PULPO_API_KEY,
  baseURL: 'https://pulpo.example.com/v1',
})

const response = await client.responses.create({
  model: 'your-pulpo-model-id',
  input: 'Hello from Pulpo',
})
```

Implemented endpoints:

- `POST /v1/responses`
- `GET /v1/responses/:id`
- `POST /v1/responses/:id/cancel`
- `GET /v1/models`

## Optional web tools

Agent mode can expose `web_search` and `web_fetch` tools backed by ordered Kagi and Firecrawl provider chains. Configure global tool availability and billing, enable each capability per provider, and arrange independent search and extraction fallback orders under Admin → Settings → Agent. Provider API keys are encrypted with `ENCRYPTION_KEY`, used only by the Pulpo worker, never copied into disposable workspaces, and never returned by the settings API.

Kagi uses the v1 Search and Extract APIs. Firecrawl uses its v2 Search and Scrape APIs and can target Firecrawl Cloud or a compatible self-hosted base URL. Private self-hosted URLs require `ALLOW_PRIVATE_PROVIDER_URLS=true`. Firecrawl scrape freshness and effective cost per credit are configurable; Pulpo records each provider attempt, the winning provider, credits, upstream costs, and billed cost on the tool execution.

Administrators may bill users independently for searches and page extracts at configurable global per-operation prices. Pulpo reserves the charge once before starting the provider chain and settles it only when one provider succeeds. Provider costs may accumulate across fallback attempts, but users are never charged per attempt. When billing is disabled, provider usage remains an operator expense and is not deducted from user balances.

Streaming uses standard Responses SSE events. Background requests return immediately and support retrieval and cancellation. Keys can be restricted by scope, model, monthly budget, and lifetime budget.

## Data protection and operations

- Passwords and API-key secrets use Argon2id. Only Pulpo API-key prefixes and hashes are stored.
- Provider credentials are encrypted with `ENCRYPTION_KEY`.
- Session cookies are HTTP-only and same-site. Mutating browser requests enforce an allowed Origin.
- Provider base URLs reject private-network targets unless `ALLOW_PRIVATE_PROVIDER_URLS=true` is explicitly set.
- Prompts, response bodies, API keys, passwords, and provider secrets are excluded from normal structured logs.
- Private attachments use presigned uploads, server-side ownership records, checksums, and cleanup of abandoned objects.
- Accounting uses atomic maximum-cost reservations and idempotent settlement against immutable pricing versions.

The admin export UI produces logical JSON/CSV exports. It is not a substitute for operator backups. Back up both PostgreSQL and object storage:

```bash
docker compose exec -T postgres pg_dump -U pulpo -Fc pulpo > pulpo-postgres.dump
docker compose exec -T postgres pg_dumpall -U pulpo --globals-only > pulpo-globals.sql
```

For SeaweedFS, snapshot or copy the named master, volume, and filer volumes while the services are stopped, or use your infrastructure's volume snapshot facility. Practice restoring the database and objects into a clean installation before relying on the backup procedure.

Upgrades should always include a backup. Pull the target release, run `docker compose build`, and use `docker compose up -d`; the API runs ordered migrations before accepting traffic. Roll back application images only to a version compatible with the migrated database.

## SMTP and password resets

Set `SMTP_URL` and `SMTP_FROM` to email one-time reset links. Without SMTP, an administrator can generate a one-hour reset token from the user administration API/UI workflow. Reset completion invalidates existing sessions.

## Horizontal API replicas

All gateways use the Redis Streams Socket.IO adapter. If more than one API replica is placed behind a load balancer, keep sticky sessions enabled while Socket.IO polling fallback is available. PostgreSQL snapshots remain authoritative even if Redis recovery data is unavailable.
