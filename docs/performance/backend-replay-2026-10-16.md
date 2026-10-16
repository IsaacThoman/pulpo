# Backend replay and retention audit — October 16, 2026

This review identified two bounded improvements: avoid decoding acknowledged response events during reconnect, and bound the process-wide response owner cache. Both preserve the existing Redis stream format and durable Socket.IO broadcasting. The measurements below cover synthetic local Redis replay and cache retention; they do not certify provider latency, production capacity, or the entire backend.

## Changes

`readResponseEvents` previously read and decoded up to 10,000 retained events before filtering by the client's sequence. It now reads Redis field pairs without allocating an object per entry and skips JSON decoding when the canonical safe integer sequence field is already acknowledged. Candidate events still pass the payload sequence filter. Legacy entries with missing, unsafe, or malformed sequence fields retain the old JSON decoding/filtering path. Invalid JSON in a relevant entry still fails; invalid JSON in an acknowledged entry with a valid stored sequence is intentionally skipped.

The query remains `XRANGE - + COUNT 10000`: Redis work, transferred history, and ioredis string materialization remain proportional to the retained stream. This change reduces JavaScript allocation and JSON decoding; it does not implement cursor-based Redis reads or repair gaps in trimmed replay history.

The response owner resolver previously retained every lookup promise for the API process's lifetime. It now keeps at most 4,096 entries, expires entries after five minutes on access, and refreshes least recently used ordering. Concurrent lookups still share one promise. Missing/failed lookups are retried, and an evicted lookup finishing later cannot remove a replacement. Expiration uses no periodic timer. Cache eviction can cause additional indexed ownership queries under high cardinality; ownership and authorization decisions are unchanged.

## Measurements

Apple M5 Pro, 48 GiB RAM, Node 26.12.0, real local Redis, 15 retained alternating samples per implementation after three warmups. The baseline decoder is copied exactly from revision `08b2b2328789243f6706452663893f5084e70fa9`; the comparison imports the working-tree production implementation. Medians below include identical `XRANGE` reads and ioredis materialization. No provider calls are involved.

| Retained events | New events | Baseline wall | Improved wall | Baseline Node CPU | Improved Node CPU | JSON parses before → after |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1,000 | 3.33 ms | 2.79 ms | 2.45 ms | 1.90 ms | 1,000 → 1,000 |
| 1,000 | 10 | 3.23 ms | 2.30 ms | 2.23 ms | 1.31 ms | 1,000 → 10 |
| 1,000 | 0 | 3.19 ms | 2.01 ms | 2.26 ms | 1.11 ms | 1,000 → 0 |
| 10,000 | 10,000 | 34.50 ms | 30.03 ms | 33.55 ms | 27.65 ms | 10,000 → 10,000 |
| 10,000 | 10 | 37.30 ms | 22.55 ms | 28.40 ms | 15.04 ms | 10,000 → 10 |
| 10,000 | 0 | 40.06 ms | 20.55 ms | 26.94 ms | 11.87 ms | 10,000 → 0 |

At 10,000 retained events and 10 unseen events, replay wall time fell 39.5% and Node CPU fell 47.1%. Both implementations still materialized approximately 11.27 MB of stream ID/field text per call. Host noise and GC affect timings; deterministic parse counts and identical result assertions are the stronger mechanism evidence. A prior run showed the same direction but lower absolute times; the table and [sanitized samples](backend-replay-2026-10-16.json) use one complete final run.

After 50,000 unique synthetic owner lookups, forced-GC retained heap fell from a median **11,025,528 bytes to 1,214,784 bytes** (89.0%). Five fresh processes per implementation isolate retention from earlier benchmark garbage; the resolver remains globally rooted during GC. This measures the old lifetime-growing Map versus the new 4,096-entry cache, not API RSS or production request latency.

## Reproduction and validation

Use installed workspace dependencies and a disposable Redis service on localhost port 56389. The driver rejects other endpoints, creates unique expiring fixture keys, and removes those keys when it finishes.

```sh
REDIS_URL=redis://127.0.0.1:56389 \
BENCH_OWNER_CACHE=1 BENCH_COMPACTION_PROBE=1 BENCH_FANOUT_PROBE=1 \
BENCH_REPLAY_OUTPUT=/tmp/pulpo-response-replay.json \
node --expose-gc --import tsx scripts/benchmarks/response-replay.ts

npm exec -w @pulpo/server -- vitest run \
  src/responses/events.test.ts src/realtime/socket.test.ts \
  src/realtime/composer-opt-out.test.ts src/realtime/chat-started.integration.test.ts
```

Replay fixtures contain 1,000 or 10,000 events, with a 256-byte text delta except for a 64 KiB completed output item every 100 events. The driver compares the exact previous implementation with the current production function, asserts identical returned events, alternates implementation order, discards three warmups each, and retains 15 samples each. CPU measurements include only the Node benchmark process. Field-byte counts include UTF-8 stream IDs/fields and exclude RESP framing; both implementations request identical Redis data. No model, generation worker, authenticated API request, or production dataset is used.

The optional cache probe runs 50,000 unique synthetic ownership lookups in each fresh Node process, forces GC while the resolver remains globally rooted, and compares retained JavaScript heap over five alternating samples. This isolates cache retention, not total API RSS. The optional compaction probe invokes the existing trimming implementation once per size with no provider. The optional fanout probe uses two real Socket.IO servers and Redis-streams adapters with the same Pub/Sub relay topology as the application; authentication and database routing are outside that harness.

Focused regressions cover replay ordering/filtering, legacy/corrupt sequence fields, relevant JSON failures, empty/null entries, concurrent ownership lookup sharing, LRU eviction, expiration, missing/failed lookup retries, and replacement races. Existing composer isolation and reconnect recovery tests are included.

Validation passed: server TypeScript build, focused lint for the changed server sources/tests and benchmark drivers, and all 25 tests in the four focused suites above. The full replay, fresh-process retention, compaction and two-server fanout diagnostics completed successfully with their equality/recovery assertions.

## Remaining findings

### Pub/Sub fanout repeats durable broadcasts across API instances

In [socket.ts:307](../../apps/server/src/realtime/socket.ts#L307), every API instance subscribes to application channels, including response events, snapshots, composer changes, administrative usage and state changes. Their handlers broadcast through the Redis-streams adapter with ordinary `.emit` ([response events at line 332](../../apps/server/src/realtime/socket.ts#L332), snapshots at line 339). With N API instances, one application message can therefore become N adapter broadcasts and N client deliveries, with up to N² adapter ingestion work. Client sequence filtering may discard repeated response events after delivery; it cannot remove the server, adapter and network cost.

Simply adding `.local` would bypass adapter publication, including the durable recovery offset and missed-packet history. The installed `socket.io-adapter` `ClusterAdapter.broadcast` only calls `publishAndReturnOffset` for nonlocal broadcasts; `RedisStreamsAdapter.restoreSession` reads the adapter stream. The existing `chat.started` handler intentionally uses `.local.volatile` because its semantics exclude recovery replay. Extending that choice to durable events would change reconnect behavior.

The real two-server diagnostic sent 50 application publications. Current durable broadcasting produced **100 deliveries per connected client and 100 adapter stream writes**. The deliberately rejected local-only variant produced 50 deliveries and zero stream writes. After a transport disconnect, both variants restored the Socket.IO session, but the current path replayed two copies of the disconnected event and the local path replayed zero. Session recovery succeeding therefore does not establish missed-packet recovery.

This finding remains unresolved. A robust architectural change should arrange one durable adapter publication per application message at its source and preserve routing, ordering and recovery across replicas; a per-event distributed lock introduces its own crash window.

### Agent history materializes contexts that are not used

[agent/runner.ts:207](../../apps/server/src/agent/runner.ts#L207) reads full response bodies for all undeleted branches, then [line 213](../../apps/server/src/agent/runner.ts#L213) loads `agent_runs.context` for every lineage response. Saved contexts contain inherited messages. [resolveAgentParentMessages](../../apps/server/src/agent/history.ts#L99) walks backward and consumes only the newest nonempty context, plus responses after it. Before compaction, N cumulative context snapshots can represent O(N²) transferred/parsed message bytes; after compaction each context is smaller, but fetching all historical contexts still scales with the whole lineage. This is code-derived complexity, not a measured production latency claim.

A follow-up should locate the newest usable ancestor context before fetching its body, then fetch only the response bodies needed after that checkpoint. Tests must preserve manual assistant edits, ancestors without agent runs, empty checkpoints, deleted/missing ancestors and branching.

The non-agent [responseLineage](../../apps/server/src/responses/worker.ts#L375) similarly reads all response bodies in the chat before choosing the active ancestors. Paginated chat history already bounds page bodies, but generation history still pays for large inactive branches. Topology selection followed by ancestor-only body loading is a separate improvement.

### First compaction still repeatedly scans and copies history

[trimHistoryToTokenLimit](../../apps/server/src/compaction/summarize.ts#L27) recomputes whole-history token totals and calls `dropOldest` once per removed unit. [dropOldestResponsesUnit](../../apps/server/src/compaction/responses-history.ts#L64) and [dropOldestPiUnit](../../apps/server/src/compaction/pi-history.ts#L72) copy/filter/scan remaining protocol history on each iteration. Token estimates are memoized per object, but summation and protocol repair remain repeated linear passes. Large initial compactions therefore approach quadratic CPU/allocation work. The existing yield every 32 drops limits continuous event-loop blocking, without reducing total work.

The final one-sample probe of the current real Responses trim path measured approximately **2.17 ms at 100 turns, 73.02 ms at 1,000, 1,253.16 ms at 5,000, and 5,033.79 ms at 10,000**. Each user and assistant message held 1,024 ASCII bytes, with a 25,000-token target; all sizes ended at 97 messages. An earlier isolated probe measured 3,448.8 ms at 10,000, illustrating host/GC variation; neither run is a repeated statistical estimate. A new trimming implementation must preserve leading-user retention, reasoning adjacency and call/result repair; blindly slicing by estimated token count would change semantics. The driver can reproduce this probe.

### Search and streaming costs need separate load measurements

[chats/routes.ts:133](../../apps/server/src/chats/routes.ts#L133) computes `to_tsvector` over the joined chat title and serialized response input/output for every search. The title-only GIN index does not match this combined expression. The code suggests growing work with account transcript volume, but no query plan or database-scale latency measurement is claimed here. Measure representative accounts with `EXPLAIN (ANALYZE, BUFFERS)` before choosing an indexed search representation, and preserve title-only chats and legacy serialized payload compatibility.

The Codex path [responses/worker.ts:545](../../apps/server/src/responses/worker.ts#L545) persists and republishes complete output on a hardcoded 250 ms interval, while other response paths use the configurable snapshot interval (default 1,500 ms). Each snapshot includes an output update, a full-row read and a Redis snapshot publication. This can amplify large-output writes; changing the interval requires measuring reconnect freshness and persistence behavior. No change or throughput claim is made here.

The ordinary upstream loop [responses/worker.ts:858](../../apps/server/src/responses/worker.ts#L858) also awaits a cancellation lookup and event-publishing pipeline per upstream event. Generation throughput may become sensitive to Redis round-trip latency at sufficiently high token/event rates. Test a synthetic upstream with realistic Redis delay, concurrent generations and cancellation-latency assertions before changing backpressure or batching semantics.
