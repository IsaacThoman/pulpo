# Queued-message acceptance tests

The fixture uses the real API, worker, database, Redis, uploads, and realtime transport with a deterministic local Responses provider. It makes no external model calls. Ports 8091 (API), 8092 (fixture), and 6391 (Redis) must be free.

## Setup

Install dependencies and build `@pulpo/contracts`, `@pulpo/client-core`, and `@pulpo/server`. With the normal local PostgreSQL container running, provision disposable resources:

```sh
docker exec pulpo-postgres-1 psql -U pulpo -d postgres -c 'CREATE DATABASE pulpo_mobile_queue_e2e'
docker run -d --name pulpo-mobile-queue-e2e-redis -p 127.0.0.1:6391:6379 redis:7-alpine
```

Use these environment variables in each backend terminal, from the repository root:

```sh
export POSTGRES_DATABASE=pulpo_mobile_queue_e2e
export REDIS_URL=redis://localhost:6391
export PUBLIC_URL=http://localhost:8091
export PORT=8091
export HOST=127.0.0.1
export ALLOW_ANY_LOCALHOST_PORT=true
export ALLOW_PRIVATE_PROVIDER_URLS=true
```

Run `npm run db:migrate -w @pulpo/server`, then keep each process running in a separate terminal:

```sh
node apps/server/dist/api.js
node apps/server/dist/worker.js
node apps/mobile/e2e/queue-provider.mjs
```

Seed only the disposable database, then run API acceptance:

```sh
node apps/mobile/e2e/queue-seed.mjs
node apps/mobile/e2e/queue-api.mjs
```

The seed refuses to run with a different database or Redis URL. The API test covers concurrent duplicate submissions, edits and cancellation, deletion, reordering, sequential dispatch, the saved model, and retrying after a queue item has dispatched. The optional `clientId` on queue creation is shared with the dispatched response ID; existing callers may omit it.

## Native acceptance

Build/run the iOS app with `EXPO_PUBLIC_DEFAULT_INSTANCE_URL=http://localhost:8091`. If a server is already saved, use **Change server** on the sign-in screen. Sign in using the disposable account `queue@example.test` / `Queue-test-only-2026`.

1. Send `HOLD Native acceptance`. The fixture keeps this response active until `POST http://localhost:8092/release`.
2. Send several follow-ups. Verify the queue, Send with a draft, and Stop with an empty composer.
3. Keep a separate draft, edit a queued item, cancel, edit again, and save. Verify restoration of the draft and model. Reorder items and delete one.
4. Stop only the test API process. Submit another follow-up, verify **Waiting to sync**, relaunch, and restart the API. Verify a single replayed queue item.
5. Queue an uploaded image from a second authenticated client. Verify realtime arrival, edit/save attachment retention, and the queued model independently of the composer model.
6. Release the held response. Verify all remaining turns finish in order with no duplicates and the queue disappears. Check the fixture's `GET /requests` and chat responses for exact execution order.

See [validation.md](validation.md) for the recorded run and screenshots. Stop the fixture/API/worker and remove only the dedicated test Redis container/database when finished.

## Fault-injection and cross-client QA

See [qa-sync-report.md](qa-sync-report.md) for the detailed run and reproduced failures.

To use the local gateway, build web and run the API on `PORT=8094` while retaining `PUBLIC_URL=http://localhost:8091`. Run `node apps/mobile/e2e/queue-proxy.mjs` from the repository root. The gateway serves `apps/web/dist` and forwards HTTP/WebSockets. Both web and simulator use port 8091.

The loopback-only control server at port 8095 accepts JSON POSTs with `online`/`realtime` booleans and `nextQueueFailure` (`"500"`, `"400"`, `"drop"`, or null). `drop` forwards the submission, then discards its acknowledgment. Restore `{ "online": true, "realtime": true, "nextQueueFailure": null }` after testing.

With the fixture and disposable account ready:

```sh
node apps/mobile/e2e/queue-api.mjs
node apps/mobile/e2e/queue-faults.mjs
node apps/mobile/e2e/queue-composer-recovery.mjs
```

Run serially: these tests deliberately release held fixture responses. The composer test uses real Socket.IO connections and persisted checkpoints to verify multiple offline accepted drafts and preservation of newer unsent text.
