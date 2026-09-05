# Composer resurrection investigation — September 5, 2026

## Reproduced cause

Reproduced using the actual iOS simulator and built web client on the same account, with a held generation. After mobile queued a message, both composers showed the submitted text again without typing in web.

The API trace recorded this sequence for the same chat:

| Client | Operation | Base revision | Server revision before write |
| --- | --- | --- | --- |
| Mobile | Draft content | 3 | 3 |
| Mobile | Clear after acceptance | 4 | 4 |
| Web | Old draft content | 5 | 5 |

Mobile's clear succeeded. The observing web client subsequently resurrected the text using the correct new revision, so the server's conflict protection could not reject it.

`Composer.tsx` read `runtimeComposerDraft()` on every render and included that mutable result in its hydration effect's dependencies. Applying a remote clear removes the in-memory draft immediately, but disk persistence is debounced by 150 ms. A further render in that interval changes the runtime lookup to null, restarts hydration even though the composer is already hydrated, and loads the old disk draft. The sync hook then publishes that restored value as a new edit. Queue updates and ordinary transcript updates can both cause that render; this is not queue-specific.

A regression using the actual web `Composer` reproduced the stale content write against the cleared revision before the fix. The earlier hook-only idle-client test missed this because it did not include local draft hydration/persistence.

## Changes

- Capture the initial runtime draft once per mounted, chat-keyed web composer and do not hydrate again after hydration completes.
- Harden the independent conditional-clear race: clear a matching accepted state using its current revision, recheck state after conflicts, and preserve acceptance receipts across failed clears. Retry at most three times per completion/reconciliation; repeated conflicts retain receipts for reconnect. Concurrent receipt processing is serialized, and acknowledgments from an old connection cannot retire receipts.
- Regression coverage includes disk/runtime hydration, two mounted mobile/web sync hooks, identical writes advancing the revision, conflicting new drafts, failed clear/restart, repeated conflicts, simultaneous receipts, and old-connection acknowledgments.

No tracing of message text or production traffic was added. Temporary diagnostics ran only in local built files and were removed from the web source before validation.

## Verification

Local setup: existing Compose PostgreSQL plus dedicated Redis 6391, disposable database `pulpo_mobile_queue_e2e`, this checkout's API/worker, deterministic local provider 8092, web gateway 8091/API 8094, and this checkout's Metro bundle in the existing iOS 26.5 development simulator. No external model calls.

- Before fix: actual native queued send with an observing web client reproduced the resurrection; trace above identifies web as the writer after a successful clear.
- After fix: native queued send stayed empty on both clients and produced no web resurrection write.
- After fix: native normal send completed with both composers empty.
- After fix: a locally injected 15-second queue-request delay allowed typing a newer draft before acceptance. The queued message became pending and the newer draft remained on both clients.
- `queue-composer-recovery.mjs` passed against real Socket.IO: multiple accepted offline receipts, restart clearing, and preservation of an unrelated remote draft.
- Full client-core, web, and mobile test suites passed; web builds, mobile typecheck, and repository lint passed. Web tests used `NODE_OPTIONS=--no-experimental-webstorage` for this machine's Node/jsdom compatibility.

The installed simulator native shell was reused with this checkout's JavaScript bundle; no new native build or physical iPhone deployment was needed. These results establish the local reproduction and fix, not deployment or verification on `dev.pulpo.baby`.
