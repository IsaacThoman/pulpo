# Synthetic long-chat benchmark — September 22, 2026

Pulpo preserves the tested message and draft data during very long conversations, but it does **not** maintain short-chat responsiveness. The main limits are unbounded rendering, quadratic server branch metadata, repeated whole-transcript persistence work, and a 25 MiB aggregate transcript-cache budget. The cache limit also changes recovery behavior for oversized conversations.

This audit measures revision `d16ead32d10ad1a113af66dc2b215432aa97e9e7`. It adds a reproducible benchmark harness and evidence summaries; it does not change application behavior.

## Method

Apple M3 Pro, 18 GiB RAM, macOS 27.0, Node 26.4.0, Playwright Chromium. The web application is the real Vite production build at 1440×900. The API runs the checked-out implementation through `tsx`, with default development configuration and warning-level logging. PostgreSQL 17/pgvector and Redis 7.4 run in dedicated local Docker containers. Existing application databases were not used.

The HTTP and browser paths use real session authentication, database queries, serialization, compression, chat hydration, React/Markdown rendering, IndexedDB, Redis publication, and Socket.IO delivery. Fixtures and generation deltas are synthetic. No paid provider, inference, generation worker, tool execution, object-storage attachments, or mobile-native application is exercised. The context-preparation experiment invokes the real compaction function with an immediate synthetic summarizer; it is not a model-quality or inference-latency benchmark.

A **turn** is one user message and one assistant message. Plain turns contain about 1 KB of prose. Rich turns contain headings, lists, fenced code, tables, and KaTeX math. The large-body fixture has 100 answers of approximately 305 KB each. All conversations have a single linear branch, no attachments, and no historic compaction checkpoints. Repeated text is unusually compressible, so network transfer is optimistic.

Each ordinary browser case has three independent browser contexts, with fresh HTTP/IndexedDB caches but warm host/server processes. The first process-level browser startup is included in the first sample. Each API case discards one warmup and retains three samples. Slower-CPU and extreme browser probes are single samples, explicitly separated below. These are diagnostic measurements on a working developer machine, not statistically precise production capacity estimates.

Browser opening ends after the expected Markdown block count and two animation frames. Each case then types a draft, scrolls with real wheel input, streams 60 deltas at a target 20 Hz through the production Redis publisher, checks the last delta and total delta count, verifies the first historical message DOM node stayed mounted, inspects persistence, and reloads with the chat-detail endpoint blocked. The completion snapshot deliberately returns to the seeded answer, so cached reload verifies fixture/draft recovery rather than durability of the temporary stream markers. The reload keeps bootstrap/static resources available, so it tests transcript recovery rather than full offline application boot.

JS heap is measured after forced garbage collection; it excludes native DOM, renderer, GPU, and browser-process memory. Frame intervals come from `requestAnimationFrame`, not a compositor FPS trace. Stream freshness measures the newest visible timestamped delta at DOM mutation; it is not a latency distribution for every emitted token or a physical-paint measurement. Long-task blocking time is the sum of time beyond 50 ms per task, not Lighthouse TBT. Garbage collection used for heap inspection can affect adjacent phase frame maxima in the initial batch; conclusions use sustained scrolling/streaming measurements, not those isolated maxima.

## Measurements

Chromium version: `153.0.8010.12`. Values below are medians of three runs. One turn equals two messages.

| Fixture | Turns | Messages | Browser open | Cached reload | JS heap after GC | DOM elements |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| plain | 10 | 20 | 0.56 s | 0.56 s | 13 MiB | 875 |
| plain | 100 | 200 | 0.54 s | 0.60 s | 18 MiB | 6,005 |
| plain | 1,000 | 2,000 | 1.59 s | 1.85 s | 68 MiB | 57,305 |
| plain | 5,000 | 10,000 | 4.68 s | 7.08 s | 282 MiB | 285,305 |
| rich | 1,000 | 2,000 | 3.34 s | 4.36 s | 136 MiB | 181,305 |
| large | 100 | 200 | 7.86 s | Failed 3/3 | 47 MiB | 6,005 |

All 18 online samples rendered the expected message count, preserved the typed draft, retained the first historical message node during streaming, and received all 60 deltas. There were no page JavaScript exceptions or HTTP error responses. All 15 cache-eligible samples restored the transcript and draft with chat detail unavailable. All three oversized samples lacked a persisted transcript and failed transcript recovery. No renderer crash occurred in this matrix.

| Fixture | Turns | Stream frame interval p95 | Scroll frame interval p95 | Newest-delta freshness p95 |
| --- | ---: | ---: | ---: | ---: |
| plain | 10 | 16.8 ms | 16.8 ms | 104 ms |
| plain | 100 | 16.7 ms | 16.7 ms | 109 ms |
| plain | 1,000 | 16.7 ms | 33.3 ms | 111 ms |
| plain | 5,000 | 66.7 ms | 66.7 ms | 180 ms |
| rich | 1,000 | 33.4 ms | 50.1 ms | 107 ms |
| large | 100 | 83.3 ms | 16.7 ms | 291 ms |

These are medians of per-run p95s. A 16.7 ms interval is approximately the 60 Hz frame budget; 66.7 ms intervals represent visibly coarse updates. Frame p95 alone can hide a single very long opening task: the 5,000-turn samples had an initial longest task of roughly 3.1–3.3 seconds. No such long task was observed during opening of the 10- or 100-turn samples.

| Fixture | Turns | API HTTP total | DB materialization | DTO construction | Branch metadata alone | Decoded response |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| plain | 10 | 13.0 ms | 1.9 ms | 0.1 ms | 0.0 ms | 0.02 MiB |
| plain | 100 | 16.2 ms | 3.8 ms | 0.5 ms | 0.1 ms | 0.21 MiB |
| plain | 500 | 25.0 ms | 7.4 ms | 4.9 ms | 2.8 ms | 1.05 MiB |
| plain | 1,000 | 42.5 ms | 11.8 ms | 17.0 ms | 12.9 ms | 2.10 MiB |
| plain | 2,500 | 149.7 ms | 39.3 ms | 77.8 ms | 46.9 ms | 5.25 MiB |
| plain | 5,000 | 344.0 ms | 70.8 ms | 298.2 ms | 206.2 ms | 10.51 MiB |
| plain | 10,000 | 961.3 ms | 103.3 ms | 1098.1 ms | 834.4 ms | 21.02 MiB |
| plain | 20,000 | 5181.8 ms | 208.6 ms | 4723.9 ms | 3922.2 ms | 42.06 MiB |
| rich | 1,000 | 42.9 ms | 12.1 ms | 12.2 ms | 6.5 ms | 2.51 MiB |
| large | 100 | 106.6 ms | 32.2 ms | 0.5 ms | 0.1 ms | 29.11 MiB |

API HTTP includes authentication and body transfer with `accept-encoding: identity`; browser measurements negotiate compression. The latter are therefore not directly additive with the HTTP timings. For example, 5,000 turns transferred approximately 450 KB compressed but expanded to 11.0 MB of JSON and hundreds of megabytes of retained browser state. The large-body fixture compressed to only about 15 KB, which is particularly optimistic for real content.

## Extreme and constrained-CPU probes

These are one sample each. All three also type into the composer while streaming. Chromium CPU throttling is a synthetic stress test, not a measurement of a particular phone. All rendered the full transcript, retained all 60 deltas and historical DOM identity, preserved simultaneous typing, and restored the cached transcript and draft without page exceptions.

| Plain turns | CPU slowdown | Open | Cached reload | JS heap after GC | Stream frame p95 | Newest-delta freshness p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 4× | 4.20 s | 5.97 s | 68 MiB | 33.4 ms | 148 ms |
| 5,000 | 4× | 17.15 s | 18.09 s | 282 MiB | 400.0 ms | 1817 ms |
| 10,000 | 1× | 10.37 s | 10.12 s | 551 MiB | 166.7 ms | 886 ms |

The 10,000-turn probe mounted 570,304 elements and had an opening long task of 6.93 seconds. Its synchronous transcript `put` reached 52 ms. With 4× CPU slowdown at 5,000 turns, streaming frame intervals reached a 400 ms p95 and newest-delta freshness reached 1.82 seconds. Correctness is preserved here, but the interactive experience is substantially degraded. The runner’s total stream phase includes waiting for concurrent typing; it is not a pure network delivery or generation-duration measure.

## Backend isolation and context experiments

A separate single-request interference probe sent `/health` requests during chat-detail reads. At 5,000 turns, a health request took 246 ms. At 20,000 turns, a health request took **3,312 ms**, despite other health probes in the same sequence taking about 2 ms. That shows the synchronous history-processing cost can delay unrelated requests in the same API process. This is not a multi-user throughput or saturation test.

An isolated sibling-index prototype grouped rows once by parent and then passed only each sibling group to the existing metadata function. It asserted identical output for every row in the measured linear fixtures. At 20,000 turns, index construction plus all metadata generation took **21.94 ms**, versus the earlier 3,922 ms median full-scan metadata measurement. This strongly supports indexing as a fix, but it is a component-level counterfactual, not an optimized HTTP benchmark; no production implementation was replaced.

| History turns | Context preparation with synthetic summarizer | Approximate tokens offered to summarizer | Approximate resulting context tokens |
| ---: | ---: | ---: | ---: |
| 10 | 0.25 ms | 0 | 2,996 |
| 1,000 | 1.96 ms | 299,716 | 1,233 |
| 5,000 | 7.40 ms | 1,506,713 | 1,235 |
| 20,000 | 41.24 ms | 6,040,461 | 1,238 |

The 10-turn case did not compact. The other cases used the real context-preparation algorithm with an immediate fixed summary and a 100,000-token threshold, retaining four turns. Approximate token counts use the application’s JSON-length/4 estimator. The 20,000-turn first-compaction request was about 6.04 million estimated tokens: successful synthetic summarization does not establish that a real model could accept that request. The synthetic model was configured with a 128,000-token context window.

## Why performance changes

### Every message remains mounted

[MessageList.tsx](../../apps/web/src/components/chat/MessageList.tsx) maps the entire message array into `MessageItem` components. There is no transcript virtualization, and both user and assistant messages invoke Markdown. Existing memoization helps updates but does not avoid the initial parsing, component allocation, effects/subscriptions, DOM creation, style work, and layout for off-screen history.

Plain chats grew from 875 DOM elements at 10 turns to 285,305 at 5,000. Retained JS heap grew from about 13 MiB to 282 MiB. In the 5,000-turn runs, opening included roughly 2.9–3.0 seconds of script execution and 0.54 seconds of layout. The large-body case had only about 6,000 elements, yet required roughly 5.4 seconds of script work and 1.9 seconds of layout: message count alone is not a sufficient performance budget.

The rich 1,000-turn fixture produced approximately 181,000 elements, versus 57,000 for plain text at the same turn count. Code, tables, and math therefore move the practical limit substantially earlier.

### Server branch metadata scans the conversation repeatedly

The detail route in [chats/routes.ts](../../apps/server/src/chats/routes.ts) selects all non-deleted responses, collects their usage and attachments, and constructs the complete response. `format=compact` avoids duplicated snapshot output. `scope=active` suppresses inactive bodies on the wire, but still loads all database response bodies and visits every turn.

[toPublicChatResponses](../../apps/server/src/chats/public.ts) calls `metadataForTurn` for each turn. [metadataForTurn](../../apps/server/src/messages/branching.ts) filters the entire conversation to find siblings. A linear conversation therefore does approximately N² parent comparisons even though nearly every response has just one sibling. The server lineage walker also uses repeated `unshift`; the shared client implementation already uses `push` and one `reverse`.

At 20,000 turns, median database materialization took 209 ms, complete DTO construction took 4,724 ms, and isolated branch-metadata construction took 3,922 ms. JSON serialization itself took only about 29 ms. The endpoint was therefore dominated by application CPU rather than a slow database lookup. These isolated timings are separate measurements and must not be added together or treated as a precise profile of the HTTP sample.

Highly branched histories were not benchmarked. They may behave worse: inactive stubs still run full response construction, and each sibling's branch metadata repeats sibling IDs. Fixing the linear-history scan alone would not necessarily bound a huge sibling group's payload.

### Update isolation helps, but work still scales with history

[MessageItem](../../apps/web/src/components/chat/MessageItem.tsx) memoizes stable message identities. The existing performance test deliberately replaces Markdown and verifies that changing one foreground message renders one row, while a background-chat update renders none. The browser benchmark independently checks preservation of an old message's DOM node and all 60 streamed chunks.

[ChatDataBridge](../../apps/web/src/features/chat/ChatDataBridge.tsx) batches events on a 50 ms timer. [Markdown](../../apps/web/src/components/chat/Markdown.tsx) refreshes streaming content on a 100 ms timer. Those are useful controls and help explain why stream freshness stays around a tenth of a second in shorter conversations.

However, [applyResponseEvents](../../apps/web/src/stores/chat.ts) copies the response-sequence map and traverses the message array on each batch. `MessageList` then maps/reconciles the full array even when unchanged row bodies bail out. Zustand subscriptions still exist for every mounted row, and layout operates on a large document. At 5,000 turns, repeated scrolling and streaming long tasks appear despite correct incremental text and stable historical DOM.

### Persistence is coalesced by chat, not by turn

Streaming updates enter the query cache about once per second; IndexedDB writes are coalesced too. Unchanged other chats retain their stored bodies. This avoids writing every historical chat on every token.

The changed chat is still persisted as a whole body. [database.ts](../../apps/web/src/lib/local-first/database.ts) writes `plan.changed` transcript objects, while [chat-cache-policy.ts](../../apps/web/src/lib/local-first/chat-cache-policy.ts) serializes each new immutable chat object and scans its UTF-8 size. A streaming update changes that object identity. The 5,000-turn benchmark recorded synchronous IndexedDB `put` work up to about 34 ms for a transcript record; serialization/size-accounting work before `put` is additional and is not included in that number. Coalescing controls frequency, not per-write growth.

The same cache policy permits **25 MiB total across retained transcript queries**, with a default 50-chat count limit. A single larger query is skipped. The 30,522,244-byte large fixture loaded online but had no persisted transcript record and failed all three detail-unavailable reloads. This is not a browser quota error or deletion of server data. It is an explicit retention policy with a user-visible recovery consequence. A less repetitive real conversation may also incur much more network cost than this fixture.

### Model compaction solves a different problem

The worker reads history and then selects the ancestor chain before preparing model input. [compactConversation](../../apps/server/src/responses/compaction.ts) can reuse the latest completed checkpoint and retain recent turns, keeping ordinary ongoing model context bounded. It does not remove old transcript rows or stop the browser rendering them.

A synthetic imported history without a checkpoint is a distinct edge case: all older context is offered to one summarization call. The experiment below reports the app's own approximate token estimate, not a provider tokenizer count. Very large first-compaction inputs can exceed a model's context window; the audit does not claim that an actual provider would accept them. Normal gradual conversations with valid checkpoints can behave much better.

## Priorities

1. **Index branch metadata once per conversation.** Group by parent and user-message identity, reuse group metadata, and avoid repeated whole-array filtering. Replace server-side `unshift` lineage walks with `push`/`reverse`. Preserve edit/regeneration/deletion semantics with branching tests.
2. **Bound the visible transcript and fetched history.** Render a window with overscan, measured row heights, stable scroll anchors, and correct stick-to-bottom behavior. Add cursor-based history loading and fetch inactive branch bodies on demand. Virtualization alone leaves network/hydration costs; pagination alone leaves a fully expanded browser transcript expensive.
3. **Persist changes per response or page.** Maintain incremental byte accounting, store immutable older chunks once, and preserve a recent usable window when the full chat exceeds the cache budget. Make partial-cache behavior clear in the product.
4. **Bound work within exceptionally large messages.** Memoize completed Markdown blocks or use incremental parsing while streaming; virtualization by message cannot make a single enormous visible answer cheap.
5. **Retain this benchmark as a regression tool.** Use separate budgets for opening, sustained interaction, memory, and cached recovery. Keep plain, rich, and large-body fixtures; test constrained CPU and real mobile hardware before setting production SLOs.

The next implementation should be judged against these same workloads and functional checks, not just a mocked row-render count. Cursor paging, branch activation/editing, history search, accessibility, resize handling, streamed code fences/math, and offline recovery all need to survive the change.

## Artifacts and validation

- [Reproduction instructions](../../scripts/benchmarks/README.md) and five benchmark/summary files in that directory.
- [Sanitized measurement summary](long-chat-benchmark-2026-09-22.json): per-run phase aggregates and API medians, without raw frame traces, message bodies, or the synthetic session token.
- Production web build and benchmark-script lint passed. The focused row-isolation regression suite passed all three tests; browser measurements remain the evidence for real Markdown/DOM costs.
- Raw traces and fixtures remain outside Git under `/tmp/pulpo-longchat-benchmark`. The disposable API and benchmark database/Redis containers are stopped and removed after measurement.

Not measured: actual provider latency/quality or billing, generation-worker queue throughput, real mobile Safari/Android/native performance, WAN conditions, large attachment/tool transcripts, huge inactive-branch graphs, hours-long memory growth, and many simultaneous users. Browser throttling does not reproduce device memory pressure or thermal behavior. The experiments establish the bottlenecks above, not a universal safe turn-count ceiling.
