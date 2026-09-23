# Long-chat benchmark

Measures the real production web application against a disposable PostgreSQL + Redis + Pulpo API stack. The seed is synthetic and generation events come from the production event publisher; the benchmark does not call an upstream model or run the generation worker.

Prerequisites: installed workspace dependencies, Docker, Node compatible with this checkout, and Playwright Chromium (`npx playwright install chromium`). Do not run CPU-heavy work concurrently with measurements.

```sh
docker run -d --name pulpo-longchat-bench-pg -e POSTGRES_PASSWORD=bench -e POSTGRES_DB=pulpo -p 127.0.0.1:55439:5432 pgvector/pgvector:0.8.6-pg17
docker run -d --name pulpo-longchat-bench-redis -p 127.0.0.1:56389:6379 redis:7.4-alpine
export DATABASE_URL=postgres://postgres:bench@127.0.0.1:55439/pulpo
export REDIS_URL=redis://127.0.0.1:56389
export BENCH_OUTPUT=/tmp/pulpo-longchat-benchmark
npm run db:migrate -w @pulpo/server
npm run build:web
PORT=3319 PUBLIC_URL=http://127.0.0.1:4319 LOG_LEVEL=warn STORAGE_LOCAL_PATH=/tmp/pulpo-longchat-objects node --import tsx apps/server/src/api.ts
```

Leave that API running. In another terminal, with the same exported variables:

```sh
node --import tsx scripts/benchmarks/long-chat-fixtures.ts
node --import tsx scripts/benchmarks/long-chat-api.ts
BENCH_VIRTUAL=1 node --import tsx scripts/benchmarks/long-chat-browser.ts
node scripts/benchmarks/long-chat-opening.mjs
node scripts/benchmarks/long-chat-layout.mjs
node scripts/benchmarks/long-chat-branches.mjs
node --import tsx scripts/benchmarks/long-chat-context.ts
node scripts/benchmarks/summarize-long-chat.mjs
```

The browser runner serves the existing `apps/web/dist` build on port 4319. It creates a fresh browser context per sample, authenticates with a synthetic session, opens the latest message, measures frame gaps/long tasks/input events/heap/DOM, types a draft, scrolls, publishes 60 deltas at a target 20 Hz through Redis and Socket.IO, verifies all deltas and records historical DOM identity (virtualized rows may unmount), inspects IndexedDB, then reloads with only the chat-detail endpoint unavailable. This last test isolates transcript-cache behavior; it is not a whole-application offline boot test.

`BENCH_VIRTUAL=1` uses latest-message readiness for paginated/virtualized builds; omit it only when benchmarking the pre-virtualization implementation, where readiness requires every Markdown block. `BENCH_CASES=plain:10,plain:1000` selects cases. `BENCH_REPEATS=1` overrides the default three repetitions. `BENCH_CPU=4` enables Chromium CPU throttling, and `BENCH_SUFFIX=-slow` selects a separate result file. `BENCH_TYPE_DURING_STREAM=1` adds simultaneous draft typing during the stream. The summary reads the default, `-slow`, `-extreme`, `-layout`, and `-rebase` files. `BENCH_VALIDATE_LAYOUT=1` also streams while scrolled away and checks the reading anchor. API measurements discard one warmup and retain three samples. HTTP measurements use uncompressed responses; normal browser requests negotiate compression.

A turn means one user message plus one assistant message. Plain turns have about 1 KB of text; rich turns add headings, lists, tables, fenced code, and inline math. The large-body case has 100 turns with roughly 305 KB per answer. Repeated prose makes compression optimistic. There are no images, tools, or inactive branches in these fixtures. Large imported histories deliberately lack compaction checkpoints.

Raw output and the synthetic session token go under `BENCH_OUTPUT`, outside the repository. Keep only sanitized summaries and reports in Git. The fixture and mutation scripts reject database URLs other than the explicit disposable endpoint. Seeds are additive; use fresh benchmark containers for a fresh dataset.

After stopping the API process, remove only the benchmark infrastructure:

```sh
docker rm -f -v pulpo-longchat-bench-pg pulpo-longchat-bench-redis
```

Measurements are local diagnostics, not production SLOs. Wall-clock stream latency ends at DOM mutation, not physical pixel presentation. Frame timing uses `requestAnimationFrame`; input timing uses Chromium Event Timing where available. Heap is JS heap after forced GC, not total renderer RSS. Browser load time includes authentication/bootstrap, network, mounting, and two animation frames. Per-phase blocking time sums `max(0, long task duration - 50ms)` and is not Lighthouse TBT.

The completion snapshot intentionally returns to the seeded answer. Cached reload checks seeded transcript and draft recovery, not persistence of the temporary timestamped stream markers. The context experiment also compares a sibling-index micro-prototype with the existing branch metadata and asserts identical results for these linear fixtures; the September 22 report records the unmodified baseline. The September 23 follow-up records the implemented optimizations.

The opening runner repeats 20 fresh cold opens and requires the warm page plus settled bottom alignment every time. The layout runner checks delayed prefetch (1.2 seconds), a large remaining scroll buffer, prepend anchoring, draft typing, desktop/mobile width changes, bottom alignment, bounded DOM, and JavaScript errors. It saves screenshots only under `BENCH_OUTPUT`. Allow up to four pixels for fractional rich-content height rounding. The branch runner creates an assistant edit through the real API, uses the UI to switch both ways, checks the bounded activation payload and draft preservation, then deletes its synthetic branch. Run these drivers sequentially because they share port 4319 and the disposable fixtures.

Raw output includes the synthetic login token and response IDs. Keep it outside Git. Commit only the benchmark drivers and sanitized aggregate summaries. The API and browser runners are designed for isolated local services; they are not a production load test.

For a direct layout comparison, build an unchanged baseline checkout and run `BENCH_BASE_WEB=/absolute/path/to/baseline/apps/web node scripts/benchmarks/long-chat-compare-layout.mjs`. It compares the final user/assistant Markdown geometry, composer, and header at desktop and phone widths and saves both screenshots outside the repository.
