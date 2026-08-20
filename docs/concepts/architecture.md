# Architecture

Pulpo is an npm-workspaces monorepo with independent web, API, worker, mobile, CLI, and infrastructure packages.

| Area | Responsibility |
| --- | --- |
| React web app | Browser interface, local cache, and realtime projections |
| Fastify API | Authentication, administration, OpenAI-compatible endpoints, and Socket.IO |
| BullMQ worker | Owns provider streams even after browsers disconnect |
| PostgreSQL | Authoritative users, conversations, response items, accounting, and audit data |
| Redis | Jobs, recent sequenced events, recovery, and replica fanout |
| Object storage | Private attachment bodies through SeaweedFS, local disk, or S3-compatible storage |
| Shared packages | Contracts and platform-neutral client behavior |

The nginx web gateway serves the application and proxies API, Responses, health, and Socket.IO traffic to Fastify.

## Repository layout

```text
apps/web/src/         React web application
apps/server/src/      API, worker, storage, accounting, and realtime services
apps/mobile/          Expo Router iPhone application
apps/cli/             Published Node.js management CLI
apps/server/drizzle/  Ordered PostgreSQL migrations
packages/contracts/   Shared Zod and Socket.IO contracts
packages/client-core/ Platform-neutral chat and client behavior
infra/                Workspace image and controller infrastructure
deploy/               nginx gateway configuration
```

Read [Local-first and realtime behavior](/concepts/realtime) for the client and synchronization model.
