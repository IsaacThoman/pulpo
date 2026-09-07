# Mobile performance audit — September 6, 2026

The largest confirmed problems are cache maintenance that blocks JavaScript for
seconds and transcript projection whose cost grows quadratically. Address those
before tuning list windows or animations.

Audited commit: `675eb02274d9e2f66212e55c1a7662acdfacb9f1`.
Evidence: [raw measurements](ios-simulator-results.json),
[environment and validation](environment.json), and
[reproduction instructions](README.md). Application behavior was not changed.

**Scope and confidence.** Source review covered startup, chat projection, list
rendering, realtime synchronization, persistence, attachment handling, and both
platform implementations. Runtime measurements used current-checkout JavaScript
in an existing Release native shell on an isolated iPhone 17 Pro / iOS 26.5
simulator, running Hermes and React Native 0.86.2 on an M3 Pro Mac. These are
synthetic function measurements, excluding React rendering, native Markdown
layout, network, and model latency. They are not physical iPhone/Android timings,
FPS measurements, heap profiles, or a complete newly built native release audit.
The initial exploratory run reproduced the same large bottlenecks; numbers below
come from the repeat run after builds had finished.

**1. [P1] Cache maintenance repeatedly scans every payload on the JS thread.**

[`database.ts:249`](../../src/data/database.ts#L249) reads and parses every cached
document, then calls [`utf8ByteLength`](../../src/data/cache.ts#L7) on every
serialized payload. That helper iterates through every character in JavaScript.
This happens on `cacheOpenedChat`, `markCachedChatOpened`, list-cache trimming,
and pruning—even when the cache is below its limits and nothing needs eviction.

| Cached documents | Serialized payload | Byte counting alone, median | Mark opened + trim, median |
| --- | ---: | ---: | ---: |
| 1 | 0.47 MiB | 66 ms | 71 ms |
| 10 | 4.68 MiB | 667 ms | 676 ms |
| 45 | 21.07 MiB | 2,904 ms | 3,040 ms |

The largest fixture is below both the default 50-document limit and the 25 MiB
quota. Nearly the entire cost comes from synchronous byte counting. The global
[`database operation queue`](../../src/data/database.ts#L25) also makes unrelated
reads/writes wait: a tiny `getValue` placed behind the 45-document operation took
3,069 ms. `enqueueCacheWrite` removes the write from the request's promise chain;
it does not move JavaScript execution to another thread or bypass that queue.
Draft persistence, cursor writes, and other cache reads can therefore accumulate
behind maintenance, in addition to JS-driven interactions stalling.

Recommended change: persist payload byte size and detail-presence metadata when
writing a document; trim using those columns and access timestamps. Fetch payloads
only for documents actually being evicted. Update only the opened document's
timestamp, and avoid rescanning/reindexing unchanged details on summary refreshes.
Keep required write ordering while reducing and coalescing maintenance work.

**2. [P1] Each streaming update rebuilds a response index twice per turn.**

[`branchVariants`](../../src/features/chat/projection.ts#L168) constructs a map of
all responses on every call. `projectChat` calls it for both the user and assistant
message of every selected turn, even when there is only one branch. A linear
conversation therefore performs approximately `2 × turns²` index insertions per
projection. [`ProductionBridge`](../../src/mockup5/src/production/ProductionBridge.tsx#L494)
runs that projection whenever the selected snapshots change, before message
reference reuse or row memoization can save rendering work.

| Turns / displayed messages | Projection median | Sample p95 |
| --- | ---: | ---: |
| 10 / 20 | 0.31 ms | 0.47 ms |
| 100 / 200 | 12.01 ms | 13.97 ms |
| 250 / 500 | 28.26 ms | 32.26 ms |
| 500 / 1,000 | 94.44 ms | 97.77 ms |
| 1,000 / 2,000 | 379.62 ms | 395.48 ms |

These fixtures have short, plain-text answers and no extra branches. Projection
alone almost consumes the app's 100 ms streaming batch interval at 500 turns,
and exceeds it at 1,000 turns. The measured cost excludes the subsequent mapping,
reconciliation, React work, and native Markdown layout. For context, a 60 Hz frame
interval is 16.67 ms; native-thread animation and scrolling can continue while
JavaScript is blocked, so these timings must not be interpreted directly as UI
FPS. [React Native performance guidance](https://reactnative.dev/docs/performance).

Recommended change: build one response map per projection and share it with
branch lookup. Then cache projection by response/snapshot identity so a streaming
delta updates only the affected message and branch data. Preserve existing stable
message references. Startup also projects every cached transcript eagerly in
[`hydrateProductionScope`](../../src/mockup5/src/production/ProductionBridge.tsx#L183);
hydrate summaries first and load transcript bodies on demand.

**3. [P2] Fetching one chat reads and parses all cached chats.**

[`chatQuery`](../../src/data/queries.ts#L95) calls `cachedChats(namespace)` and then
finds the requested ID. Its `Promise.all` waits for this full cache read alongside
the server request, even when an in-memory chat is already available.
[`cachedChats`](../../src/data/database.ts#L380) selects every payload and parses
every document.

At 45 documents, the existing read-all-and-find path took **84.91 ms median**;
an indexed single-document read and parse of the same target took **5.89 ms**.
This is separate from the maintenance delay above. The one-document fixture showed
no benefit, as expected; the problem scales with unrelated cached data.

Recommended change: add a namespaced, ID-based cached-chat reader. Use memory
where its contents are sufficient and read only the persisted document required
for reconciliation. Keep list queries restricted to lightweight summaries.

**4. [P2] Transcript hydration publishes one store update per response.**

[`ProductionBridge.tsx:478`](../../src/mockup5/src/production/ProductionBridge.tsx#L478)
calls `receiveSnapshot` in a loop. Each new snapshot
[`copies the entire snapshots record`](../../src/providers/realtimeStore.ts#L62)
and synchronously notifies subscribers. Hydrating 1,000 snapshots produced
**1,000 notifications and took 28 ms median / 33.75 ms sample p95**, using only a
trivial counting subscriber. The production selected-snapshot subscription also
enumerates transcript response IDs on each notification. React batching does not
eliminate the underlying external-store copies and subscription checks.

Recommended change: merge an incoming snapshot collection in one store operation,
copying the record once and notifying subscribers once. Preserve sequence checks
and the existing snapshot-merge semantics.

**5. [P2] Completed transcript data has no bounded in-memory eviction policy.**

Leaving a chat removes socket subscriptions but does not remove its completed
snapshots. Every visited transcript adds data to the global realtime record, and
each later update copies that growing record. The synthetic hydration check
retained **2,000 snapshots after feeding 20 distinct 100-turn chats**. This is an
entry-count check, not a measured heap leak or UI-navigation test; source inspection
confirms that normal unsubscribe does not evict completed snapshots.

The prototype store also retains projected messages for visited chats, while
[`QueryClient`](../../src/providers/AppProviders.tsx#L85) retains inactive queries
for 24 hours. SQLite's 25 MiB / document-count limits do not bound those stores.
The object graphs can share references, so their sizes should not simply be
added together as an estimate of memory consumption.

Recommended change: apply an explicit in-memory transcript LRU and shorter
retention for inactive detail queries. Release terminal snapshots after durable
reconciliation when no active consumer needs them. Protect active responses,
pending optimistic operations, and reconnect requirements from eviction.

**Existing strengths.** The transcript and main history list are virtualized.
Completed message references are reused, legacy mappings use WeakMaps, and
message/Markdown rows are memoized. Realtime deltas are coalesced into 100 ms
batches and cursor writes are delayed. Attachments use thumbnail endpoints,
deduplicated downloads, and file-backed storage. Cached session hydration can
show the authenticated shell without awaiting the network. These measures are
useful; the upstream data processing costs above remain despite them.

**Validation and remaining coverage.** Mobile type checking passed, all 408 tests
across 65 files passed, and iOS/Android production exports succeeded. Exported
Hermes bundles were 7,991,054 bytes for iOS and 8,289,074 bytes for Android, with
1,171,283 bytes of exported assets. Those are bundle sizes, not installed app
sizes or startup measurements.

An additional full-app startup smoke attempt using current JavaScript in the
reused shell failed because that older native binary lacks `ExpoImage`. This is
a native-shell mismatch, not evidence that a fresh build of this checkout
crashes. It prevents a full-app startup result here. The isolated benchmark does
not import ExpoImage and completed successfully with the native SQLite and
filesystem modules it uses. A fresh native build is required for full-screen
profiling.

Next validation should run a freshly built Release app on physical iOS and
Android devices with long conversations, a near-quota cache, sustained streaming,
Markdown tables/code/math, image galleries, chat switching, and repeated
background/foreground cycles. Measure JS stalls, native layout time, input
latency, peak/retained memory, and cold-start time. No authenticated account,
production data, or external model was used in this audit.
